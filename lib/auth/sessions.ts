import type { Prisma } from '@prisma/client'
import type { Session } from 'next-auth'
import { isIP } from 'node:net'

import { recordAudit } from '@/lib/audit'
import { prisma } from '@/lib/database/prisma'

import { SecurityError, lockSecurityUser } from './security/shared'

export const BROWSER_SESSION_SECONDS = 30 * 24 * 60 * 60
export const LOGIN_HISTORY_DAYS = 90
export type LoginMetadata = {
  ipAddress: string | null
  userAgent: string | null
}

export function loginMetadata(headers: {
  get(name: string): string | null
}): LoginMetadata {
  const candidate =
    headers.get('x-real-ip') ||
    headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    ''
  return {
    ipAddress: isIP(candidate) ? candidate : null,
    userAgent:
      headers
        .get('user-agent')
        ?.replace(/[\u0000-\u001f\u007f]/g, '')
        .slice(0, 256) || null,
  }
}

/** A version snapshot from successful authentication fences concurrent revoke-all. */
export async function createBrowserSession(
  userId: string,
  sessionVersion: number,
  authMethod: string,
  metadata: LoginMetadata
) {
  const result = await prisma.$transaction(async (tx) => {
    const user = await lockSecurityUser(tx, userId)
    if (user.sessionVersion !== sessionVersion)
      throw new SecurityError('Session invalidated: Version mismatch', 401)
    const session = await tx.browserSession.create({
      data: {
        userId,
        sessionVersion,
        authMethod,
        ...metadata,
        expiresAt: new Date(Date.now() + BROWSER_SESSION_SECONDS * 1000),
      },
    })
    await tx.loginAttempt.create({
      data: { userId, authMethod, outcome: 'success', ...metadata },
    })
    return { session, name: user.name }
  })
  await recordAudit({
    action: 'auth.login',
    category: 'authentication',
    actorId: userId,
    actorName: result.name || userId,
    targetType: 'session',
    targetId: result.session.id,
    details: { authMethod, ...metadata },
  })
  return result.session
}

export async function validateBrowserSession(
  userId: string,
  id: string | undefined,
  sessionVersion: number
) {
  if (!id)
    throw new SecurityError(
      'Session invalidated: Sign in again after upgrading.',
      401
    )
  const now = new Date()
  const session = await prisma.browserSession.findFirst({
    where: {
      id,
      userId,
      sessionVersion,
      revokedAt: null,
      expiresAt: { gt: now },
    },
  })
  if (!session)
    throw new SecurityError(
      'Session invalidated: Session revoked or expired',
      401
    )
  if (now.getTime() - session.lastSeenAt.getTime() >= 60_000) {
    // Updating activity must never resurrect a concurrently revoked record.
    await prisma.browserSession.updateMany({
      where: {
        id,
        userId,
        revokedAt: null,
        lastSeenAt: { lt: new Date(now.getTime() - 60_000) },
      },
      data: { lastSeenAt: now },
    })
  }
  return session
}

/** Failed credentials are never retained. Unknown accounts remain anonymous. */
export async function recordFailedLogin(
  authMethod: string,
  metadata: LoginMetadata,
  identity: { email?: string; passkeyId?: string; userId?: string } = {}
) {
  let user: { id: string; name: string | null } | null = null
  if (identity.userId)
    user = await prisma.user.findUnique({
      where: { id: identity.userId },
      select: { id: true, name: true },
    })
  else if (identity.email && identity.email.length <= 320) {
    if (authMethod === 'passkey-recovery') {
      const email = identity.email
        .trim()
        .replace(/[\\%_]/g, (character) => `\\${character}`)
      const matches = await prisma.user.findMany({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { id: true, name: true },
        take: 2,
      })
      if (matches.length === 1) user = matches[0]
    } else
      user = await prisma.user.findUnique({
        where: { email: identity.email },
        select: { id: true, name: true },
      })
  } else if (identity.passkeyId)
    user =
      (
        await prisma.passkey.findUnique({
          where: { id: identity.passkeyId },
          select: { user: { select: { id: true, name: true } } },
        })
      )?.user || null
  if (user)
    await prisma.loginAttempt.create({
      data: { userId: user.id, authMethod, outcome: 'failure', ...metadata },
    })
  await recordAudit({
    action: 'auth.login',
    category: 'authentication',
    outcome: 'failure',
    actorId: null,
    targetType: 'user',
    targetId: user?.id,
    targetName: user?.name || undefined,
    details: { authMethod, ...metadata },
  })
}

async function lockSessionOwner(
  tx: Prisma.TransactionClient,
  session: Session
) {
  const user = await lockSecurityUser(tx, session.user.id)
  if (
    user.sessionVersion !== session.user.sessionVersion ||
    !session.user.sessionId
  )
    throw new SecurityError('Sign in again to continue.', 401)
  const current = await tx.browserSession.findFirst({
    where: {
      id: session.user.sessionId,
      userId: user.id,
      sessionVersion: user.sessionVersion,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  })
  if (!current) throw new SecurityError('Sign in again to continue.', 401)
  return user
}

export async function revokeBrowserSessions(session: Session, id?: string) {
  const result = await prisma.$transaction(async (tx) => {
    const user = await lockSessionOwner(tx, session)
    const now = new Date()
    const where = {
      userId: user.id,
      sessionVersion: user.sessionVersion,
      revokedAt: null,
      expiresAt: { gt: now },
      ...(id ? { id } : {}),
    }
    const revoked = await tx.browserSession.updateMany({
      where,
      data: { revokedAt: now },
    })
    if (id && !revoked.count) throw new SecurityError('Session not found.', 404)
    if (!id)
      await tx.user.update({
        where: { id: user.id },
        data: { sessionVersion: { increment: 1 } },
      })
    return {
      revokedCount: revoked.count,
      signedOut: !id || id === session.user.sessionId,
    }
  })
  await recordAudit({
    action: id ? 'auth.session.revoked' : 'auth.sessions.revoked',
    category: 'authentication',
    actorId: session.user.id,
    actorName: session.user.name || session.user.id,
    targetType: 'session',
    targetId: id,
    details: { count: result.revokedCount, includesCurrent: result.signedOut },
  })
  return result
}

export async function signOutBrowserSession(
  userId: string,
  id?: string,
  actorName?: string | null
) {
  if (!id) return
  const result = await prisma.browserSession.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  if (result.count)
    await recordAudit({
      action: 'auth.logout',
      category: 'authentication',
      actorId: userId,
      actorName: actorName || userId,
      targetType: 'session',
      targetId: id,
    })
}

export async function listBrowserSessions(session: Session) {
  const sessions = await prisma.browserSession.findMany({
    where: {
      userId: session.user.id,
      sessionVersion: session.user.sessionVersion,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      createdAt: true,
      lastSeenAt: true,
      expiresAt: true,
      authMethod: true,
      ipAddress: true,
      userAgent: true,
    },
  })
  return {
    sessions: sessions.map((row) => ({
      ...row,
      current: row.id === session.user.sessionId,
    })),
  }
}

export async function listLoginHistory(
  userId: string,
  outcome = 'all',
  cursor?: string
) {
  if (!['all', 'success', 'failure'].includes(outcome))
    throw new SecurityError('Invalid login outcome filter.')
  let before: { createdAt: Date; id: string } | undefined
  if (cursor) {
    if (cursor.length > 512) throw new SecurityError('Invalid history cursor.')
    try {
      const decoded = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8')
      )
      if (
        typeof decoded.id !== 'string' ||
        decoded.id.length > 100 ||
        typeof decoded.at !== 'string' ||
        !Number.isFinite(Date.parse(decoded.at))
      )
        throw new Error()
      before = { createdAt: new Date(decoded.at), id: decoded.id }
    } catch {
      throw new SecurityError('Invalid history cursor.')
    }
  }
  const rows = await prisma.loginAttempt.findMany({
    where: {
      userId,
      createdAt: { gte: new Date(Date.now() - LOGIN_HISTORY_DAYS * 86400000) },
      ...(outcome !== 'all' ? { outcome } : {}),
      ...(before
        ? {
            OR: [
              { createdAt: { lt: before.createdAt } },
              { createdAt: before.createdAt, id: { lt: before.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 26,
    select: {
      id: true,
      createdAt: true,
      authMethod: true,
      outcome: true,
      ipAddress: true,
      userAgent: true,
    },
  })
  const attempts = rows.slice(0, 25)
  const last = attempts.at(-1)
  return {
    attempts,
    nextCursor:
      rows.length > 25 && last
        ? Buffer.from(
            JSON.stringify({ at: last.createdAt.toISOString(), id: last.id })
          ).toString('base64url')
        : null,
  }
}

/** Indexed bounded batches retain 90 days, independent of sign-in availability. */
export async function cleanupSessionHistory() {
  await prisma.$executeRaw`
    WITH expired AS MATERIALIZED (
      SELECT "id" FROM "LoginAttempt" WHERE "createdAt" < NOW() - INTERVAL '90 days'
      ORDER BY "createdAt" LIMIT 1000 FOR UPDATE SKIP LOCKED
    ) DELETE FROM "LoginAttempt" USING expired WHERE "LoginAttempt"."id" = expired."id"
  `
  await prisma.$executeRaw`
    WITH expired AS MATERIALIZED (
      SELECT "id" FROM "BrowserSession" WHERE "expiresAt" < NOW() - INTERVAL '90 days'
      ORDER BY "expiresAt" LIMIT 1000 FOR UPDATE SKIP LOCKED
    ) DELETE FROM "BrowserSession" USING expired WHERE "BrowserSession"."id" = expired."id"
  `
}
