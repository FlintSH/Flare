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
import { connectionKey, effectiveScopes } from '@/lib/oauth/connections'
import { ACCESS_TOKEN_PREFIX } from '@/lib/oauth/constants'
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

type Policy = Awaited<ReturnType<typeof accountPolicy>>

type TokenAccount = Prisma.ApiTokenGetPayload<{
  include: { user: { select: typeof accountSelect } }
}>

/** The principal behind a usable token that carries the `mcp` marker, or null. */
function tokenPrincipal(
  token: TokenAccount | null,
  policy: Policy
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

/** Reads the account a credential belongs to along with it. */
const withAccount = { user: { select: accountSelect } } as const

type ConnectionAccount = Prisma.AgentConnectionGetPayload<{
  include: { user: { select: typeof accountSelect } }
}>

/**
 * The principal behind a connection that has not been ended, or null. Its
 * scopes are what the person granted, within the ceiling of the token pair
 * the request came with; without a pair, the whole grant.
 */
function connectionPrincipal(
  connection: ConnectionAccount | null,
  policy: Policy,
  pair: { narrowed: boolean; scopes: readonly string[] } = {
    narrowed: false,
    scopes: [],
  }
): AgentPrincipal | null {
  if (!connection || connection.revokedAt) return null
  const account = accountFrom(connection.user, policy)
  if (account.emailAccessRequired) return null
  const credentialKey = connectionKey(connection.id)
  // The audit actor has one place for a credential; the key says which kind.
  setAuditActor({ id: account.id, name: account.name, tokenId: credentialKey })
  const scopes = effectiveScopes(connection.scopes, pair)
  const user: AuthenticatedUser = {
    ...authenticated(account, 'agent'),
    agentConnection: { id: connection.id, scopes },
  }
  return {
    user,
    name: account.name,
    scopes,
    credentialKey,
    can: (permission: Permission) => hasPermission(user, permission),
  }
}

/** A request's bearer value under a named token: the PR 1 path, unchanged. */
async function authenticateToken(
  supplied: string
): Promise<AgentPrincipal | null> {
  const [token, policy] = await Promise.all([
    prisma.apiToken.findUnique({
      where: { hash: hashApiToken(supplied) },
      include: withAccount,
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

/** A request's bearer value as the access token of a sign-in, until it expires. */
async function authenticateAccessToken(
  supplied: string
): Promise<AgentPrincipal | null> {
  const [pair, policy] = await Promise.all([
    prisma.agentToken.findUnique({
      where: { accessHash: hashApiToken(supplied) },
      include: { connection: { include: withAccount } },
    }),
    accountPolicy(),
  ])
  if (!pair || pair.accessExpiresAt <= new Date()) return null
  const principal = connectionPrincipal(pair.connection, policy, pair)
  if (principal)
    // Best-effort, as for a token.
    await prisma.agentConnection
      .update({
        where: { id: pair.connectionId },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {})
  return principal
}

/**
 * Who a request to the MCP endpoint acts as, or null. Only an
 * `Authorization: Bearer` header authenticates: session cookies are never
 * read, and the legacy upload token is never tried. A named token must carry
 * the `mcp` marker, so a token made for a script cannot drive an agent. An
 * access token from a sign-in works until it expires or its connection ends.
 * As on the REST API, an account that still has to verify its email is
 * refused.
 */
export async function authenticateAgent(
  request: Request
): Promise<AgentPrincipal | null> {
  // HTTP authentication schemes are case-insensitive; token values are not.
  const supplied = /^Bearer +(.+)$/i.exec(
    request.headers.get('authorization') ?? ''
  )?.[1]
  if (supplied?.startsWith(TOKEN_PREFIX)) return authenticateToken(supplied)
  if (supplied?.startsWith(ACCESS_TOKEN_PREFIX))
    return authenticateAccessToken(supplied)
  return null
}

/**
 * The principal a transfer URL was made for, as it stands now: null once the
 * credential is revoked, expired or no longer marked for MCP, or the account
 * must verify its email. A URL is made for a connection, not for one of its
 * access tokens, so it outlives a refresh and holds the connection's grant.
 */
export async function credentialPrincipal(
  credentialKey: string
): Promise<AgentPrincipal | null> {
  const [kind, id] = credentialKey.split(':')
  if (!id) return null
  if (kind === 'token') {
    const [token, policy] = await Promise.all([
      prisma.apiToken.findUnique({ where: { id }, include: withAccount }),
      accountPolicy(),
    ])
    return tokenPrincipal(token, policy)
  }
  if (kind === 'connection') {
    const [connection, policy] = await Promise.all([
      prisma.agentConnection.findUnique({
        where: { id },
        include: withAccount,
      }),
      accountPolicy(),
    ])
    return connectionPrincipal(connection, policy)
  }
  return null
}
