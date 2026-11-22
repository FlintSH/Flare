import { HttpError } from '@/lib/http/errors'
import { clientIp } from '@/lib/security/client-ip'
import { consumeLimit } from '@/lib/security/database-limit'

import type { EmailConfig } from './schema'

/** A full email limit refused the request; it resets in `retryAfter` seconds. */
export class EmailRateLimitError extends HttpError {
  constructor(readonly retryAfter: number) {
    super(429, 'Too many email requests. Please try again later.', {
      headers: { 'Retry-After': String(retryAfter) },
    })
    this.name = 'EmailRateLimitError'
  }
}

async function consumeEmailLimit(key: string, limit: number, seconds: number) {
  const { allowed, resetsIn } = await consumeLimit(
    'EmailRateLimit',
    key,
    limit,
    seconds
  )
  if (!allowed) throw new EmailRateLimitError(resetsIn)
}

/** Counts an email request by its client address, then by `address` when it sends to one. */
export async function limitEmailRequest(
  req: Request,
  config: EmailConfig,
  address?: string
) {
  const ip = clientIp(req.headers) ?? 'unknown'
  await limitEmailRequestBy(`ip:${ip}`, config, address)
}

/**
 * The same limits keyed by another requester, such as `account:<id>` for a
 * caller with no client address of its own. The requester gets the per-IP
 * hourly limit; the recipient limits are shared with every other caller.
 */
export async function limitEmailRequestBy(
  requester: string,
  config: EmailConfig,
  address?: string
) {
  await consumeEmailLimit(`email:${requester}`, config.limits.ipPerHour, 3600)
  if (address) {
    const normalized = address.trim().toLowerCase()
    await consumeEmailLimit(
      `email:address:${normalized}`,
      config.limits.addressPerHour,
      3600
    )
    await consumeEmailLimit(
      `email:cooldown:${normalized}`,
      1,
      config.limits.resendSeconds
    )
  }
}
