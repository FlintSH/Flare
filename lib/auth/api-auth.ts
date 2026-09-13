import { NextResponse } from 'next/server'

import { getAccessSession } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { getEmailConfig } from '@/lib/email/config'
import { requiresEmailVerification } from '@/lib/email/policy'
import {
  TOKEN_PREFIX,
  hashApiToken,
  tokenAllowsRequest,
} from '@/lib/integrations/tokens'

export type AuthenticatedUser = {
  id: string
  storageUsed: number
  urlId: string
  vanityId: string | null
  role: string
  randomizeFileUrls: boolean
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
      token.revokedAt ||
      (token.expiresAt && token.expiresAt <= new Date()) ||
      !tokenAllowsRequest(token.scopes, req) ||
      requiresEmailVerification(token.user, await getEmailConfig())
    )
      return null
    // Best-effort activity metadata must not make an otherwise valid request fail.
    await prisma.apiToken
      .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {})
    const { id, storageUsed, urlId, vanityId, role, randomizeFileUrls } =
      token.user
    return {
      id,
      storageUsed,
      urlId,
      vanityId,
      role,
      randomizeFileUrls,
      apiToken: {
        id: token.id,
        scopes: token.scopes,
        profileId: token.profileId,
      },
    }
  }
  const session = await getAccessSession()
  if (session?.user) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        storageUsed: true,
        urlId: true,
        vanityId: true,
        role: true,
        randomizeFileUrls: true,
        email: true,
        emailVerified: true,
        emailVerifiedFor: true,
        emailVerificationSource: true,
        emailExempt: true,
        createdAt: true,
      },
    })
    return user && !requiresEmailVerification(user, await getEmailConfig())
      ? user
      : null
  }

  if (suppliedToken) {
    const user = await prisma.user.findUnique({
      where: { uploadToken: suppliedToken },
      select: {
        id: true,
        storageUsed: true,
        urlId: true,
        vanityId: true,
        role: true,
        randomizeFileUrls: true,
        email: true,
        emailVerified: true,
        emailVerifiedFor: true,
        emailVerificationSource: true,
        emailExempt: true,
        createdAt: true,
      },
    })
    return user && !requiresEmailVerification(user, await getEmailConfig())
      ? user
      : null
  }

  return null
}

export async function requireAuth(req: Request) {
  const user = await getAuthenticatedUser(req)
  if (!user) {
    return {
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      user: null,
    }
  }
  return { user, response: null }
}

export async function requireAdmin() {
  const session = await getAccessSession()

  if (!session?.user || session.user.role !== 'ADMIN') {
    return {
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      user: null,
    }
  }

  return { user: session.user, response: null }
}
