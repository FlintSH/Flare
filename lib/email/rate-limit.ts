import { clientIp } from '@/lib/security/client-ip'
import { consumeLimit } from '@/lib/security/database-limit'

import type { EmailConfig } from './schema'

/** A full email limit refused the request; it resets in `retryAfter` seconds. */
export class EmailRateLimitError extends Error {
  constructor(readonly retryAfter: number) {
    super('Too many email requests. Please try again later.')
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

export async function limitEmailRequest(
  req: Request,
  config: EmailConfig,
  address?: string
) {
  const ip = clientIp(req.headers) ?? 'unknown'
  await consumeEmailLimit(`email:ip:${ip}`, config.limits.ipPerHour, 3600)
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
