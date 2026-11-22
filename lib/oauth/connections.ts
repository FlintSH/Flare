import type { Prisma } from '@prisma/client'

import { recordAudit } from '@/lib/audit'
import { prisma } from '@/lib/database/prisma'

import { AUDIT_CATEGORY } from './constants'
import { signInScopes } from './urls'

type Transaction = Prisma.TransactionClient

/**
 * Why a connection ended: its owner disconnected it, its client revoked it,
 * an old refresh token or a used authorization code came back, or the account
 * was signed out everywhere.
 */
export type RevokedReason =
  'disconnected' | 'revoked' | 'replay' | 'code-reuse' | 'sessions-revoked'

/** What identifies a connection in rate limits, transfer URLs and the audit log. */
export const connectionKey = (id: string) => `connection:${id}`

/**
 * What one token pair can do: what the person granted the connection, within
 * the pair's own ceiling when it has one. Scopes a sign-in cannot grant never
 * pass, whatever a row holds.
 */
export function effectiveScopes(
  granted: readonly string[],
  pair: { narrowed: boolean; scopes: readonly string[] }
): string[] {
  return signInScopes(granted).filter(
    (scope) => !pair.narrowed || pair.scopes.includes(scope)
  )
}

/** The connections of an account that still work: not revoked, with a refresh token left. */
const live = (userId: string, now: Date) =>
  ({
    userId,
    revokedAt: null,
    tokens: { some: { refreshExpiresAt: { gt: now } } },
  }) satisfies Prisma.AgentConnectionWhereInput

export function countLiveConnections(
  client: Pick<Transaction, 'agentConnection'>,
  userId: string,
  now = new Date()
): Promise<number> {
  return client.agentConnection.count({ where: live(userId, now) })
}

/** An account's connected agents, newest first, as the integrations screen lists them. */
export async function listConnections(userId: string) {
  const connections = await prisma.agentConnection.findMany({
    where: live(userId, new Date()),
    select: {
      id: true,
      clientName: true,
      redirectUri: true,
      scopes: true,
      createdAt: true,
      lastUsedAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })
  return connections.map(({ redirectUri, scopes, ...connection }) => ({
    ...connection,
    /** The redirect address its sign-in returned to. */
    returnsTo: redirectUri,
    scopes: signInScopes(scopes),
  }))
}

// The row locks of agent sign-in, in the order they are taken. They come
// after the locks in `lib/database/locks.ts`, whose order holds here too.
//
//   1. The account's row (`lockUserRow`): approving a sign-in, redeeming its
//      code, publishing an upload, and signing the account out everywhere.
//   2. The connection's row (`lockConnection`, `holdConnection`): everything
//      that ends a connection or changes what it may do, a refresh, and an
//      upload that is about to publish for it.
//   3. Its token pairs and transfer URLs.
//
// A path may skip a step, but never goes back up: nothing that holds a
// connection's row asks for an account's row, and nothing that holds a pair
// or a transfer URL asks for either.
//
// Two things take rows out of that order, and so never wait for one:
//
//   - The periodic sweep (`cleanUpSignIn`, `deleteExpiredTransfers`) goes
//     through whole tables. It takes only rows nobody holds
//     (`FOR UPDATE SKIP LOCKED`) and leaves the rest to its next run.
//   - Deleting an account lets the database cascade, which takes the
//     account's transfer URLs and connections in an order of its own.
//     Ending one connection therefore passes over a transfer URL that
//     somebody else holds (see `revokeConnection`).

type RowTx = Pick<Transaction, '$queryRaw'>

/**
 * One connection's row, for a change to it: ending it, editing what it may
 * do, or rotating one of its refresh tokens. Whoever holds it is the only
 * one changing the connection until their transaction ends.
 */
export async function lockConnection(tx: RowTx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "AgentConnection" WHERE "id" = ${id} FOR UPDATE`
}

/**
 * One connection's row, held as it is: nobody can end or edit the connection
 * until this transaction ends, and whoever was already doing so finishes
 * first. Several holders can share it.
 */
export async function holdConnection(tx: RowTx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "AgentConnection" WHERE "id" = ${id} FOR SHARE`
}

/**
 * Ends one connection, in the caller's transaction: marks it revoked and
 * deletes its token pairs and transfer URLs, so nothing of it works from the
 * moment this commits. False when it was not there, not the account's, or
 * already ended. The row is locked first, so an upload that is publishing
 * for the connection finishes before this does, and one that comes after
 * sees it ended.
 *
 * A transfer URL that another transaction holds at that moment is passed
 * over instead of waited for. Whoever holds it is deleting it (the sweep,
 * the account being deleted) or starting an upload with it, and a deletion
 * of the account can hold these URLs while it waits for this connection:
 * waiting for it in turn would stop both. A URL left behind opens nothing,
 * because every use reads its connection again and finds it ended, and the
 * sweep removes it when it expires.
 */
export async function revokeConnection(
  tx: Transaction,
  where: { id: string; userId?: string },
  reason: RevokedReason
): Promise<boolean> {
  await lockConnection(tx, where.id)
  const { count } = await tx.agentConnection.updateMany({
    where: { ...where, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  })
  if (!count) return false
  await tx.agentToken.deleteMany({ where: { connectionId: where.id } })
  await tx.$executeRaw`
    WITH free AS MATERIALIZED (
      SELECT "id" FROM "AgentTransfer"
      WHERE "credential" = ${connectionKey(where.id)}
      ORDER BY "id" FOR UPDATE SKIP LOCKED
    )
    DELETE FROM "AgentTransfer" USING free
    WHERE "AgentTransfer"."id" = free."id"
  `
  return true
}

/**
 * Ends every connection of an account and discards its sign-ins in progress,
 * in the caller's transaction. It is part of signing the account out
 * everywhere, so it runs inside whatever transaction does that and uses
 * nothing but plain statements on it.
 *
 * The account's row is locked first, as redeeming an authorization code
 * locks it: of a revocation and a sign-in that finish together, the second
 * sees what the first did. Either the code is gone before it is redeemed, or
 * the connection it made is revoked here.
 */
export async function revokeAccountConnections(
  tx: Pick<Transaction, '$executeRaw'>,
  userId: string,
  reason: RevokedReason
): Promise<void> {
  await tx.$executeRaw`SELECT 1 FROM "User" WHERE "id" = ${userId} FOR UPDATE`
  // Then each connection's row, as ending one of them takes it: an upload
  // publishing for one of them finishes first.
  await tx.$executeRaw`
    SELECT 1 FROM "AgentConnection"
    WHERE "userId" = ${userId} ORDER BY "id" FOR UPDATE
  `
  await tx.$executeRaw`DELETE FROM "OAuthCode" WHERE "userId" = ${userId}`
  // Prisma keeps times as UTC without a zone; NOW() alone follows the session's.
  const revoked = await tx.$executeRaw`
    UPDATE "AgentConnection"
    SET "revokedAt" = (NOW() AT TIME ZONE 'UTC'), "revokedReason" = ${reason}
    WHERE "userId" = ${userId} AND "revokedAt" IS NULL
  `
  await tx.$executeRaw`
    DELETE FROM "AgentToken" USING "AgentConnection"
    WHERE "AgentToken"."connectionId" = "AgentConnection"."id"
      AND "AgentConnection"."userId" = ${userId}
  `
  await tx.$executeRaw`
    DELETE FROM "AgentTransfer"
    WHERE "userId" = ${userId} AND "credential" LIKE 'connection:%'
  `
  // These statements go around the audit of single writes, so the event is
  // recorded here. It is written once the transaction commits.
  if (revoked > 0)
    await recordAudit({
      action: 'agent_connection.revokeAll',
      category: AUDIT_CATEGORY,
      targetType: 'user',
      targetId: userId,
      details: { count: revoked, reason },
    })
}

/**
 * Whether a connection is still live and still granted every one of
 * `scopes`, and stays so until `tx` ends. Uploads ask inside the transaction
 * that publishes a file. The row is held from here to the commit, so the
 * answer cannot go stale: ending or editing the connection either finished
 * before this read, and is seen by it, or waits until the file is published.
 * A file is never published after its connection's end has committed.
 */
export async function connectionHolds(
  tx: RowTx & Pick<Transaction, 'agentConnection'>,
  id: string,
  scopes: readonly string[]
): Promise<boolean> {
  await holdConnection(tx, id)
  const connection = await tx.agentConnection.findUnique({
    where: { id },
    select: { revokedAt: true, scopes: true },
  })
  return Boolean(
    connection &&
    !connection.revokedAt &&
    scopes.every((scope) => connection.scopes.includes(scope))
  )
}
