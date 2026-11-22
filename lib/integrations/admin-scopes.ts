import type { Prisma } from '@prisma/client'

import { recordAudit } from '@/lib/audit'
import { auditContext } from '@/lib/audit/context'
import { pastGrant, revokeConnection } from '@/lib/oauth/connections'

import { ADMIN_SCOPES } from './bearer-routes'

type Tx = Prisma.TransactionClient

/**
 * Why the scopes are taken away: administration was turned off, or it was
 * turned on while some row still held one, which nothing should have let
 * happen while it was off.
 */
export type StripReason = 'administration-off' | 'administration-on'

/**
 * Takes every administration scope away from every credential, in the
 * caller's transaction: named tokens, sign-in connections, the narrowed
 * ceilings of their token pairs, and authorization codes not yet redeemed.
 * Turning administration through MCP off runs this in the transaction that
 * saves the setting, so turning it on again revives nothing: each scope has
 * to be granted afresh. Turning it on runs it too, for a grant that slipped
 * past the switch: no credential can rightly hold one while it was off.
 *
 * A credential left with no scope keeps working with what remains: a token
 * still carries Agent access and a connection still signs in, and the agent
 * sees `get_account` and whatever its other scopes allow. Nothing else about
 * it changes, so its owner decides whether to keep it.
 *
 * The caller holds the settings lock. Every grant of an administration scope
 * (creating a token, editing a connection, the consent decision, redeeming
 * a code) takes that lock before any row and reads the setting under it, so
 * it either finished before this and is stripped here, or waits and sees
 * the setting this saves. The rows are then taken in the order sign-in
 * takes them: connections, then their pairs, then codes. A connection past
 * its 30 days is ended rather than stripped (see below).
 */
export async function stripAdminScopes(
  tx: Tx,
  reason: StripReason
): Promise<void> {
  const scopes: string[] = [...ADMIN_SCOPES]
  // Each array keeps its order, without the administration scopes.
  const tokens = await tx.$executeRaw`
    UPDATE "ApiToken" SET "scopes" = ARRAY(
      SELECT kept.scope FROM unnest("scopes") WITH ORDINALITY AS kept(scope, n)
      WHERE NOT kept.scope = ANY(${scopes}::text[]) ORDER BY kept.n
    )
    WHERE "scopes" && ${scopes}::text[]
  `
  // A connection past the 30 days of its administration grant has ended,
  // and taking the scope away would bring it back. It is ended the way a
  // disconnect ends one, with its token pairs and transfer URLs; only the
  // connections still within their 30 days lose the scopes. Both lists are
  // read at one moment, so a connection crossing the line between them is
  // in neither, keeps its scopes, and stays refused until the sweep.
  const now = new Date()
  const ended = await tx.agentConnection.findMany({
    where: { revokedAt: null, ...pastGrant(now) },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  for (const { id } of ended) await revokeConnection(tx, { id }, 'expired')
  const within = await tx.agentConnection.findMany({
    where: { scopes: { hasSome: scopes }, NOT: pastGrant(now) },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  const withinIds = within.map(({ id }) => id)
  const connections = withinIds.length
    ? await tx.$executeRaw`
        UPDATE "AgentConnection" SET "scopes" = ARRAY(
          SELECT kept.scope FROM unnest("scopes") WITH ORDINALITY AS kept(scope, n)
          WHERE NOT kept.scope = ANY(${scopes}::text[]) ORDER BY kept.n
        )
        WHERE "id" = ANY(${withinIds}::text[]) AND "scopes" && ${scopes}::text[]
      `
    : 0
  const pairs = await tx.$executeRaw`
    UPDATE "AgentToken" SET "scopes" = ARRAY(
      SELECT kept.scope FROM unnest("scopes") WITH ORDINALITY AS kept(scope, n)
      WHERE NOT kept.scope = ANY(${scopes}::text[]) ORDER BY kept.n
    )
    WHERE "scopes" && ${scopes}::text[]
  `
  await tx.$executeRaw`
    UPDATE "OAuthCode" SET "scopes" = ARRAY(
      SELECT kept.scope FROM unnest("scopes") WITH ORDINALITY AS kept(scope, n)
      WHERE NOT kept.scope = ANY(${scopes}::text[]) ORDER BY kept.n
    )
    WHERE "scopes" && ${scopes}::text[]
  `
  // These statements go around the audit of single writes, so the change is
  // recorded here, as part of the transaction: it is written when the
  // transaction commits and never when it rolls back. The audited client
  // queues events for its transactions and writes them after the commit;
  // a transaction opened any other way gets the row written through itself.
  // Only allowlisted detail names are kept.
  const count = tokens + connections + pairs
  if (!(count > 0)) return
  const event = {
    action: 'mcp.administration.scopesRemoved',
    category: 'mcp',
    details: { count, reason },
  }
  if (auditContext.getStore()?.pending) await recordAudit(event)
  else
    await tx.auditEvent.create({
      data: { ...event, outcome: 'success', actorName: 'System' },
    })
}
