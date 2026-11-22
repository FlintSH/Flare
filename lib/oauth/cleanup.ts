import { prisma } from '@/lib/database/prisma'
import { ADMIN_SCOPES } from '@/lib/integrations/bearer-routes'

import { adminConnectionCutoff, pastGrant } from './connections'
import { MAX_UNUSED_CLIENTS, UNUSED_CLIENT_HOURS } from './constants'

/** Rows one sweep statement takes at a time. */
export const SWEEP_BATCH = 1000
/** Batches of one kind a single run takes, so a run always ends. */
const MAX_BATCHES = 50

/**
 * Runs one sweep statement until a batch comes back short, and counts what
 * it removed.
 *
 * A sweep goes through a whole table, in an order no other transaction
 * shares. So every sweep statement takes only rows nobody else holds
 * (`FOR UPDATE SKIP LOCKED`, in id order) and never waits for one. A row it
 * passes over is found by the next run. Something that never waits cannot
 * be half of a deadlock, whatever order the other half takes its rows in:
 * signing an account out everywhere, deleting it, ending one connection.
 */
export async function inBatches(
  remove: () => Promise<number>
): Promise<number> {
  let removed = 0
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const count = await remove()
    removed += count
    if (count < SWEEP_BATCH) break
  }
  return removed
}

/**
 * Removes what agent sign-in leaves behind; the periodic maintenance runs it.
 *
 * - Authorization codes past their minute, used or not.
 * - Registrations nobody approved within a day, and beyond 500 of those the
 *   oldest: registering needs no account, so the table is bounded here. A
 *   registration someone approved is kept, because its client may sign in
 *   again with the `client_id` it remembers.
 * - Token pairs whose refresh token expired: 90 days after they were issued,
 *   which for the newest pair of a connection means 90 days unused.
 * - Connections that ended, connections left without a pair, and
 *   connections holding an administration scope 30 days after they were
 *   authorized, which no entry point accepts any more.
 *
 * Two of these reach further rows through the database's cascades, and do
 * not wait there either, because there is nothing to reach:
 *
 * - A connection takes its pairs with it. One that ended has none: ending a
 *   connection deletes its pairs in the same transaction. An administration
 *   connection past its 30 days can still have some, and they go with it.
 *   Whatever adds or changes a pair (a refresh, an ending) holds the
 *   connection's row first, and a connection whose row is held is passed
 *   over here.
 * - A registration takes its codes and connections with it, and one nobody
 *   approved has neither: approving sets `usedAt` in the transaction that
 *   writes the first code, and holds the registration's row while it does.
 *
 * Times are compared as UTC without a zone, which is how Prisma keeps them.
 * A time given to a raw statement arrives with a zone, and compared as it is
 * the answer would follow the database session's time zone.
 */
export async function cleanUpSignIn(now = new Date()) {
  const unusedSince = new Date(
    now.getTime() - UNUSED_CLIENT_HOURS * 60 * 60_000
  )
  const codes = await inBatches(
    () => prisma.$executeRaw`
      WITH gone AS MATERIALIZED (
        SELECT "hash" FROM "OAuthCode"
        WHERE "expiresAt" <= (${now}::timestamptz AT TIME ZONE 'UTC')
        ORDER BY "hash" LIMIT ${SWEEP_BATCH} FOR UPDATE SKIP LOCKED
      )
      DELETE FROM "OAuthCode" USING gone
      WHERE "OAuthCode"."hash" = gone."hash"
    `
  )
  // A registration approved while this runs has its row held, or is seen as
  // approved once the row is taken: either way it stays.
  const stale = await inBatches(
    () => prisma.$executeRaw`
      WITH gone AS MATERIALIZED (
        SELECT "id" FROM "OAuthClient"
        WHERE "usedAt" IS NULL
          AND "createdAt" <= (${unusedSince}::timestamptz AT TIME ZONE 'UTC')
        ORDER BY "id" LIMIT ${SWEEP_BATCH} FOR UPDATE SKIP LOCKED
      )
      DELETE FROM "OAuthClient" USING gone
      WHERE "OAuthClient"."id" = gone."id" AND "OAuthClient"."usedAt" IS NULL
    `
  )
  // The newest 500 are only read; the rows taken are the ones beyond them.
  const evicted = await inBatches(
    () => prisma.$executeRaw`
      WITH gone AS MATERIALIZED (
        SELECT "id" FROM "OAuthClient"
        WHERE "usedAt" IS NULL AND "id" IN (
          SELECT "id" FROM "OAuthClient"
          WHERE "usedAt" IS NULL
          ORDER BY "createdAt" DESC, "id" DESC
          OFFSET ${MAX_UNUSED_CLIENTS}
        )
        ORDER BY "id" LIMIT ${SWEEP_BATCH} FOR UPDATE SKIP LOCKED
      )
      DELETE FROM "OAuthClient" USING gone
      WHERE "OAuthClient"."id" = gone."id" AND "OAuthClient"."usedAt" IS NULL
    `
  )
  const pairs = await inBatches(
    () => prisma.$executeRaw`
      WITH gone AS MATERIALIZED (
        SELECT "id" FROM "AgentToken"
        WHERE "refreshExpiresAt" <= (${now}::timestamptz AT TIME ZONE 'UTC')
        ORDER BY "id" LIMIT ${SWEEP_BATCH} FOR UPDATE SKIP LOCKED
      )
      DELETE FROM "AgentToken" USING gone
      WHERE "AgentToken"."id" = gone."id"
    `
  )
  // Connections are audited: the rows are taken here, and then removed
  // through the audited delete, which records each one it removes. It locks
  // the rows it is given, and these are already this transaction's.
  const adminCutoff = adminConnectionCutoff(now)
  const adminScopes: string[] = [...ADMIN_SCOPES]
  const connections = await inBatches(() =>
    prisma.$transaction(async (tx) => {
      const free = await tx.$queryRaw<{ id: string }[]>`
        SELECT c."id" FROM "AgentConnection" AS c
        WHERE c."revokedAt" IS NOT NULL
          OR NOT EXISTS (
            SELECT 1 FROM "AgentToken" AS t WHERE t."connectionId" = c."id"
          )
          OR (
            c."scopes" && ${adminScopes}::text[]
            AND c."createdAt" <= (${adminCutoff}::timestamptz AT TIME ZONE 'UTC')
          )
        ORDER BY c."id" LIMIT ${SWEEP_BATCH} FOR UPDATE OF c SKIP LOCKED
      `
      if (!free.length) return 0
      const { count } = await tx.agentConnection.deleteMany({
        where: {
          id: { in: free.map(({ id }) => id) },
          OR: [
            { revokedAt: { not: null } },
            { tokens: { none: {} } },
            pastGrant(now),
          ],
        },
      })
      return count
    })
  )
  return { codes, clients: stale + evicted, pairs, connections }
}
