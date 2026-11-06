import { Prisma } from '@prisma/client'

import { lockUserRow } from '@/lib/database/locks'
import { HttpError } from '@/lib/http/errors'
import { consumeLimit } from '@/lib/security/database-limit'
import { publicOrigin } from '@/lib/security/public-origin'

import { SECURITY_LIMIT_MINUTES } from './policy'

export class SecurityError extends HttpError {
  constructor(
    message: string,
    status = 400,
    options: { headers?: Record<string, string> } = {}
  ) {
    super(status, message, options)
    this.name = 'SecurityError'
  }
}

export function relyingParty() {
  const url = publicOrigin()
  if (!url)
    throw new SecurityError(
      'Configure NEXTAUTH_URL with the public HTTPS origin before using passkeys.',
      503
    )
  if (url.protocol !== 'https:' && url.hostname !== 'localhost')
    throw new SecurityError(
      'Passkeys require HTTPS, or HTTP on localhost.',
      503
    )
  return { rpID: url.hostname, origin: url.origin, rpName: 'Flare' }
}

const SECURITY_LIMIT_SECONDS = SECURITY_LIMIT_MINUTES * 60

/**
 * Counts one security attempt under `key`, such as an account or a client
 * address, and refuses it once `limit` attempts fall in one window.
 */
export async function securityLimit(key: string, limit = 20) {
  const { allowed } = await consumeLimit(
    'AuthRateLimit',
    `auth:${key}`,
    limit,
    SECURITY_LIMIT_SECONDS
  )
  if (!allowed)
    throw new SecurityError(
      `Too many security attempts. Try again in ${SECURITY_LIMIT_MINUTES} minutes.`,
      429,
      // The whole window, as the message says, not the time left in it.
      { headers: { 'Retry-After': String(SECURITY_LIMIT_SECONDS) } }
    )
}

export async function lockSecurityUser(
  tx: Prisma.TransactionClient,
  id: string
) {
  await lockUserRow(tx, id)
  const user = await tx.user.findUnique({ where: { id } })
  if (!user) throw new SecurityError('Sign in again to continue.', 401)
  return user
}
