import type { Prisma } from '@prisma/client'

import { setAuditActor } from '@/lib/audit'
import { accountFrom, accountPolicy, accountSelect } from '@/lib/auth/account'
import { type AuthenticatedUser, authenticated } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'
import { MCP_SCOPE } from '@/lib/integrations/bearer-routes'
import {
  TOKEN_PREFIX,
  hashApiToken,
  tokenUsable,
} from '@/lib/integrations/tokens'
import { type Permission, hasPermission } from '@/lib/permissions/catalog'

import type { ToolSubject } from './catalog'

/**
 * The account an agent acts as, and what its credential lets it do. The
 * scopes leave out the `mcp` marker, which only says the token may be used
 * here.
 */
export type AgentPrincipal = {
  user: AuthenticatedUser
  /** The account's display name, for answers and the audit log. */
  name: string | null
  scopes: readonly string[]
  /** What identifies the credential in rate limits and transfer URLs. */
  credentialKey: string
} & ToolSubject

type TokenAccount = Prisma.ApiTokenGetPayload<{
  include: { user: { select: typeof accountSelect } }
}>

/** The principal behind a usable token that carries the `mcp` marker, or null. */
function tokenPrincipal(
  token: TokenAccount | null,
  policy: Awaited<ReturnType<typeof accountPolicy>>
): AgentPrincipal | null {
  if (!token || !tokenUsable(token) || !token.scopes.includes(MCP_SCOPE))
    return null
  const account = accountFrom(token.user, policy)
  if (account.emailAccessRequired) return null
  setAuditActor({ id: account.id, name: account.name, tokenId: token.id })
  const user: AuthenticatedUser = {
    ...authenticated(account, 'token'),
    apiToken: {
      id: token.id,
      scopes: token.scopes,
      profileId: token.profileId,
    },
  }
  return {
    user,
    name: account.name,
    scopes: token.scopes.filter((scope) => scope !== MCP_SCOPE),
    credentialKey: `token:${token.id}`,
    can: (permission: Permission) => hasPermission(user, permission),
  }
}

const tokenAccount = { user: { select: accountSelect } } as const

/**
 * Who a request to the MCP endpoint acts as, or null. Only an
 * `Authorization: Bearer` header authenticates: session cookies are never
 * read, and the legacy upload token is never tried. A named token must carry
 * the `mcp` marker, so a token made for a script cannot drive an agent. As on
 * the REST API, an account that still has to verify its email is refused.
 */
export async function authenticateAgent(
  request: Request
): Promise<AgentPrincipal | null> {
  // HTTP authentication schemes are case-insensitive; token values are not.
  const supplied = /^Bearer +(.+)$/i.exec(
    request.headers.get('authorization') ?? ''
  )?.[1]
  if (!supplied?.startsWith(TOKEN_PREFIX)) return null
  const [token, policy] = await Promise.all([
    prisma.apiToken.findUnique({
      where: { hash: hashApiToken(supplied) },
      include: tokenAccount,
    }),
    accountPolicy(),
  ])
  const principal = tokenPrincipal(token, policy)
  if (principal && token)
    // Best-effort activity metadata must not make an otherwise valid request fail.
    await prisma.apiToken
      .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {})
  return principal
}

/**
 * The principal a transfer URL was made for, as it stands now: null once the
 * credential is revoked, expired or no longer marked for MCP, or the account
 * must verify its email.
 */
export async function credentialPrincipal(
  credentialKey: string
): Promise<AgentPrincipal | null> {
  const [kind, id] = credentialKey.split(':')
  if (kind !== 'token' || !id) return null
  const [token, policy] = await Promise.all([
    prisma.apiToken.findUnique({ where: { id }, include: tokenAccount }),
    accountPolicy(),
  ])
  return tokenPrincipal(token, policy)
}
