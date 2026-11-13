import { setAuditActor } from '@/lib/audit'
import { getAccessSession } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import {
  TOKEN_PREFIX,
  hashApiToken,
  tokenAllowsRequest,
  tokenUsable,
} from '@/lib/integrations/tokens'
import type { RoleSummary } from '@/lib/permissions/catalog'

import {
  type Account,
  accountFrom,
  accountPolicy,
  accountSelect,
  loadAccount,
  sessionAccount,
} from './account'

export type AuthenticatedUser = {
  id: string
  storageUsed: number
  urlId: string
  vanityId: string | null
  permissions: string[]
  roles: RoleSummary[]
  randomizeFileUrls: boolean
  /** The browser session cookie, a named token or the legacy upload token. */
  credential: 'session' | 'token' | 'upload-token'
  apiToken?: { id: string; scopes: string[]; profileId: string | null }
}

export async function getAuthenticatedUser(
  req: Request
): Promise<AuthenticatedUser | null> {
  // HTTP authentication schemes are case-insensitive; token values are not.
  const suppliedToken = /^Bearer +(.+)$/i.exec(
    req.headers.get('authorization') ?? ''
  )?.[1]
  // A named bearer token always uses its own authority, even if cookies coexist.
  if (suppliedToken?.startsWith(TOKEN_PREFIX)) {
    const [token, policy] = await Promise.all([
      prisma.apiToken.findUnique({
        where: { hash: hashApiToken(suppliedToken) },
        include: { user: { select: accountSelect } },
      }),
      accountPolicy(),
    ])
    if (!token || !tokenUsable(token) || !tokenAllowsRequest(token.scopes, req))
      return null
    const account = accountFrom(token.user, policy)
    if (account.emailAccessRequired) return null
    setAuditActor({ id: account.id, name: account.name, tokenId: token.id })
    // Best-effort activity metadata must not make an otherwise valid request fail.
    await prisma.apiToken
      .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {})
    return {
      ...authenticated(account, 'token'),
      apiToken: {
        id: token.id,
        scopes: token.scopes,
        profileId: token.profileId,
      },
    }
  }
  const session = await getAccessSession()
  if (session?.user)
    return accountUser(await sessionAccount(session.user.id), 'session')
  if (suppliedToken)
    return accountUser(
      await loadAccount({ uploadToken: suppliedToken }),
      'upload-token'
    )
  return null
}

function authenticated(
  { id, storageUsed, urlId, vanityId, randomizeFileUrls, access }: Account,
  credential: AuthenticatedUser['credential']
): AuthenticatedUser {
  return {
    id,
    storageUsed,
    urlId,
    vanityId,
    ...access,
    randomizeFileUrls,
    credential,
  }
}

/** The account behind a browser session or the legacy upload token, unless it must verify its email first. */
function accountUser(
  account: Account | null,
  credential: 'session' | 'upload-token'
): AuthenticatedUser | null {
  if (!account || account.emailAccessRequired) return null
  setAuditActor({ id: account.id, name: account.name })
  return authenticated(account, credential)
}
