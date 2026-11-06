import type { Prisma } from '@prisma/client'

import { setAuditActor } from '@/lib/audit'
import { getAccessSession } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { getEmailConfig } from '@/lib/email/config'
import { requiresEmailVerification } from '@/lib/email/policy'
import {
  TOKEN_PREFIX,
  hashApiToken,
  tokenAllowsRequest,
  tokenUsable,
} from '@/lib/integrations/tokens'
import type { RoleSummary } from '@/lib/permissions/catalog'
import { getUserAccess } from '@/lib/permissions/server'

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
    const token = await prisma.apiToken.findUnique({
      where: { hash: hashApiToken(suppliedToken) },
      include: { user: true },
    })
    if (
      !token ||
      !tokenUsable(token) ||
      !tokenAllowsRequest(token.scopes, req) ||
      requiresEmailVerification(token.user, await getEmailConfig())
    )
      return null
    setAuditActor({
      id: token.user.id,
      name: token.user.name,
      tokenId: token.id,
    })
    // Best-effort activity metadata must not make an otherwise valid request fail.
    await prisma.apiToken
      .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {})
    const { id, storageUsed, urlId, vanityId, randomizeFileUrls } = token.user
    return {
      id,
      storageUsed,
      urlId,
      vanityId,
      ...(await getUserAccess(id)),
      randomizeFileUrls,
      credential: 'token',
      apiToken: {
        id: token.id,
        scopes: token.scopes,
        profileId: token.profileId,
      },
    }
  }
  const session = await getAccessSession()
  if (session?.user) return accountUser({ id: session.user.id }, 'session')
  if (suppliedToken)
    return accountUser({ uploadToken: suppliedToken }, 'upload-token')
  return null
}

/** The account behind a browser session or the legacy upload token, unless it must verify its email first. */
async function accountUser(
  where: Prisma.UserWhereUniqueInput,
  credential: 'session' | 'upload-token'
): Promise<AuthenticatedUser | null> {
  const user = await prisma.user.findUnique({
    where,
    select: {
      id: true,
      name: true,
      storageUsed: true,
      urlId: true,
      vanityId: true,
      randomizeFileUrls: true,
      email: true,
      emailVerified: true,
      emailVerifiedFor: true,
      emailVerificationSource: true,
      emailExempt: true,
      createdAt: true,
    },
  })
  if (!user || requiresEmailVerification(user, await getEmailConfig()))
    return null
  setAuditActor({ id: user.id, name: user.name })
  return { ...user, ...(await getUserAccess(user.id)), credential }
}
