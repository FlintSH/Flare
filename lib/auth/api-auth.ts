import type { Prisma } from '@prisma/client'
import { timingSafeEqual } from 'node:crypto'

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
  apiToken?: {
    id: string
    scopes: string[]
    profileId: string | null
    /** Issued before end-to-end encryption: its uploads are plain files. */
    predatesEncryption: boolean
  }
}

/** The legacy upload token is recorded as used at most once in this time. */
const LEGACY_USE_INTERVAL_MS = 3_600_000

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
        predatesEncryption: token.predatesEncryption,
      },
    }
  }
  const session = await getAccessSession()
  if (session?.user) {
    const found = await accountUser({ id: session.user.id }, 'session')
    if (!found) return null
    const {
      uploadTokenHash: _hash,
      uploadTokenUsedAt: _usedAt,
      ...user
    } = found
    return user
  }
  if (suppliedToken) return legacyTokenUser(suppliedToken)
  return null
}

/**
 * The account behind the upload token from before end-to-end encryption
 * (docs/e2ee-spec.md, section 14.4). The database holds the SHA-256 of the
 * token, like a named token, so the lookup is by the hash of what the
 * request sent. The stored and the calculated hash are compared again in
 * constant time, so the answer does not depend on how the index compares.
 */
async function legacyTokenUser(
  suppliedToken: string
): Promise<AuthenticatedUser | null> {
  const hash = hashApiToken(suppliedToken)
  const found = await accountUser({ uploadTokenHash: hash }, 'upload-token')
  if (!found) return null
  const { uploadTokenHash, uploadTokenUsedAt, ...user } = found
  if (
    !uploadTokenHash ||
    uploadTokenHash.length !== hash.length ||
    !timingSafeEqual(Buffer.from(uploadTokenHash), Buffer.from(hash))
  )
    return null
  // The application warns the owner while an old configuration is in use.
  // Best effort, and at most one write in each interval.
  const now = Date.now()
  if (
    !uploadTokenUsedAt ||
    now - uploadTokenUsedAt.getTime() > LEGACY_USE_INTERVAL_MS
  )
    await prisma.user
      .updateMany({
        where: { id: user.id, uploadTokenHash: hash },
        data: { uploadTokenUsedAt: new Date(now) },
      })
      .catch(() => {})
  return user
}

/** The account behind a browser session or the legacy upload token, unless it must verify its email first. */
async function accountUser(
  where: Prisma.UserWhereUniqueInput,
  credential: 'session' | 'upload-token'
) {
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
      uploadTokenHash: true,
      uploadTokenUsedAt: true,
    },
  })
  if (!user || requiresEmailVerification(user, await getEmailConfig()))
    return null
  setAuditActor({ id: user.id, name: user.name })
  return { ...user, ...(await getUserAccess(user.id)), credential }
}
