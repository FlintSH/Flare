import type { Prisma } from '@prisma/client'

import type { ArchiveActor } from '@/lib/archives/http'
import { readConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { MCP_SCOPE } from '@/lib/integrations/bearer-routes'
import { tokenUsable } from '@/lib/integrations/tokens'
import { connectionHolds } from '@/lib/oauth/connections'
import { type Permission, hasPermission } from '@/lib/permissions/catalog'
import { getUserAccess } from '@/lib/permissions/server'

import type { AgentPrincipal } from './auth'
import {
  TOOL_CATALOG,
  type ToolName,
  type ToolNeeds,
  missingNeeds,
} from './catalog'
import { ToolError } from './tool'

type Transaction = Prisma.TransactionClient

/**
 * Whether the credential behind `principal`, read through `tx` as it is now,
 * may still use `scopes` over MCP: the token or connection is live and holds
 * every one of them, and the server is still on.
 *
 * It is asked in the transaction that makes an agent's work take effect, and
 * the answer cannot go stale before that transaction ends. For an agent that
 * signed in, the connection's row is held from here to the commit. A named
 * token's row must be held already: an upload takes it itself, and
 * `archiveActor` takes it for the archive services. Ending or editing the
 * credential therefore either finished before this read, and is seen by it,
 * or waits for the commit. Nothing is published after a credential's end has
 * committed.
 */
export async function credentialHolds(
  tx: Transaction,
  principal: AgentPrincipal,
  scopes: readonly string[]
): Promise<boolean> {
  const connectionId = principal.user.agentConnection?.id
  const tokenId = principal.user.apiToken?.id
  let live = false
  if (connectionId) live = await connectionHolds(tx, connectionId, scopes)
  else if (tokenId) {
    const token = await tx.apiToken.findUnique({ where: { id: tokenId } })
    live = Boolean(
      token &&
      tokenUsable(token) &&
      [MCP_SCOPE, ...scopes].every((scope) => token.scopes.includes(scope))
    )
  }
  return live && (await readConfig(tx)).settings.general.mcp.enabled
}

/** A named token's row, held so that nothing ends or edits it before the commit. */
async function holdToken(tx: Transaction, principal: AgentPrincipal) {
  const tokenId = principal.user.apiToken?.id
  if (tokenId)
    await tx.$queryRaw`SELECT "id" FROM "ApiToken" WHERE "id" = ${tokenId} FOR SHARE`
}

const ENDED =
  'This connection was disconnected, lost the access this call needs, or the MCP server was turned off while the call was running.'

/**
 * Refuses a save whose call lost its access since it began. `needs` is what
 * the tool and every effect the call required ask for. Read through `tx`,
 * as things are now, the credential must be live and hold every scope among
 * them with the server on, and the account's role every permission.
 *
 * The caller holds the role lock and the account's row, in that order, so
 * the role cannot change before the commit, and the credential's row is
 * taken here and held as long. Disconnecting the agent, removing a
 * permission from it or changing the role therefore either committed before
 * this read, and refuses the save, or waits for it. The refusal says why;
 * the tool adds what was and was not saved.
 */
export async function stillAllowed(
  tx: Transaction,
  principal: AgentPrincipal,
  needs: readonly ToolNeeds[]
): Promise<void> {
  await holdToken(tx, principal)
  const scopes = [...new Set(needs.flatMap((need) => need.scopes))]
  if (!(await credentialHolds(tx, principal, scopes)))
    throw new ToolError(ENDED, 'denied')
  const access = await getUserAccess(principal.user.id, tx)
  const now = {
    scopes: principal.scopes,
    can: (permission: Permission) => hasPermission(access, permission),
  }
  const lost = [
    ...new Set(needs.flatMap((need) => missingNeeds(need, now).permissions)),
  ]
  if (lost.length)
    throw new ToolError(
      `The account's role stopped holding ${lost.join(', ')} while the call was running. An administrator can change that under Roles.`,
      'denied'
    )
}

/**
 * The account an agent acts as, as the archive services take it: the
 * principal, the session version the account is on as the call starts, and
 * the last check on the credential.
 *
 * The services read access again under the account's locks, in the
 * transaction that publishes what they made and when a slow read is
 * rechecked. There they refuse if the account was signed out everywhere
 * meanwhile, as they do for the browser, and run this check: the credential
 * must still hold the scopes of `tool`. Its row is taken after the role lock
 * and the account's row, which the services hold by then, the order uploads
 * take it in (see `lib/oauth/connections.ts`).
 */
export async function archiveActor(
  principal: AgentPrincipal,
  tool: ToolName
): Promise<ArchiveActor> {
  const { scopes, annotations } = TOOL_CATALOG[tool]
  const account = await prisma.user.findUnique({
    where: { id: principal.user.id },
    select: { sessionVersion: true },
  })
  if (!account) throw new ToolError('This account no longer exists.', 'denied')
  return {
    user: principal.user,
    sessionVersion: account.sessionVersion,
    async authorize(tx) {
      // An upload holds its token's row before it asks; nothing has here yet.
      await holdToken(tx, principal)
      if (!(await credentialHolds(tx, principal, scopes)))
        throw new ToolError(
          `${ENDED}${annotations.readOnly ? '' : ' Nothing was created.'}`,
          'denied'
        )
    },
  }
}
