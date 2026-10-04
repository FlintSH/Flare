import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/database/prisma'

import { securityHash } from './crypto'

export class SecurityError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message)
  }
}

export function relyingParty() {
  let url: URL
  try {
    url = new URL(process.env.NEXTAUTH_URL || '')
  } catch {
    throw new SecurityError(
      'Configure NEXTAUTH_URL with the public HTTPS origin before using passkeys.',
      503
    )
  }
  if (
    url.username ||
    url.password ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && url.hostname === 'localhost'))
  ) {
    throw new SecurityError(
      'Passkeys require HTTPS, or HTTP on localhost.',
      503
    )
  }
  return { rpID: url.hostname, origin: url.origin, rpName: 'Flare' }
}

export function validateSecurityOrigin(req: Request) {
  let origin: string
  try {
    origin = new URL(process.env.NEXTAUTH_URL || '').origin
  } catch {
    throw new SecurityError(
      'Configure NEXTAUTH_URL before changing account security.',
      503
    )
  }
  if (req.headers.get('origin') !== origin)
    throw new SecurityError('Invalid request origin.', 403)
  if (req.headers.has('authorization'))
    throw new SecurityError('Use a browser session for account security.', 401)
}

export async function securityLimit(key: string, limit = 20, seconds = 900) {
  const digest = securityHash(`auth:${key}`)
  const rows = await prisma.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "AuthRateLimit" ("key", "count", "resetAt")
    VALUES (${digest}, 1, NOW() + ${seconds} * INTERVAL '1 second')
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "AuthRateLimit"."resetAt" <= NOW() THEN 1 ELSE "AuthRateLimit"."count" + 1 END,
      "resetAt" = CASE WHEN "AuthRateLimit"."resetAt" <= NOW() THEN NOW() + ${seconds} * INTERVAL '1 second' ELSE "AuthRateLimit"."resetAt" END
    RETURNING "count"
  `
  if (rows[0].count > limit)
    throw new SecurityError(
      'Too many security attempts. Try again in 15 minutes.',
      429
    )
}

export function requestIp(headers: { get(name: string): string | null }) {
  return (
    headers.get('x-real-ip') ||
    headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    'unknown'
  )
}

export async function lockSecurityUser(
  tx: Prisma.TransactionClient,
  id: string
) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE`
  const user = await tx.user.findUnique({ where: { id } })
  if (!user) throw new SecurityError('Sign in again to continue.', 401)
  return user
}
