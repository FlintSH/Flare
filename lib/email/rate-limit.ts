import { createHash } from 'node:crypto'

import { prisma } from '@/lib/database/prisma'

import type { EmailConfig } from './schema'

export class EmailRateLimitError extends Error {
  constructor() {
    super('Too many email requests. Please try again later.')
  }
}

/** Atomic database counters also limit requests across replicas and restarts. */
export async function consumeEmailLimit(
  key: string,
  limit: number,
  seconds: number
) {
  const digest = createHash('sha256').update(key).digest('hex')
  const rows = await prisma.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "EmailRateLimit" ("key", "count", "resetAt")
    VALUES (${digest}, 1, NOW() + ${seconds} * INTERVAL '1 second')
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "EmailRateLimit"."resetAt" <= NOW() THEN 1 ELSE "EmailRateLimit"."count" + 1 END,
      "resetAt" = CASE WHEN "EmailRateLimit"."resetAt" <= NOW() THEN NOW() + ${seconds} * INTERVAL '1 second' ELSE "EmailRateLimit"."resetAt" END
    RETURNING "count"
  `
  if (rows[0].count > limit) throw new EmailRateLimitError()
}

export async function limitEmailRequest(
  req: Request,
  config: EmailConfig,
  address?: string
) {
  // Reverse proxies must replace forwarded headers, rather than append client input.
  const ip =
    req.headers.get('x-real-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    'unknown'
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
