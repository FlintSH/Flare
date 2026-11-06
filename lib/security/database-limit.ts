import { Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'

import { prisma } from '@/lib/database/prisma'

/** Tables of limit counters, one row per key, with the same columns. */
type LimitTable = 'AuthRateLimit' | 'EmailRateLimit'

/**
 * Counts one request against `key` in a window of `seconds` that opens with
 * the key's first request. Every replica updates the same row, so the limit
 * holds across processes and restarts. Rows are keyed by the SHA-256 digest of
 * `key`, so no address or email is stored. Returns whether this request is
 * within `limit`, and the whole seconds until the window closes.
 */
export async function consumeLimit(
  table: LimitTable,
  key: string,
  limit: number,
  seconds: number
) {
  const digest = createHash('sha256').update(key).digest('hex')
  const [bucket] = await prisma.$queryRaw<
    Array<{ count: number; resetsIn: number }>
  >`
    INSERT INTO ${Prisma.raw(`"${table}"`)} AS bucket ("key", "count", "resetAt")
    VALUES (${digest}, 1, NOW() + ${seconds} * INTERVAL '1 second')
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN bucket."resetAt" <= NOW() THEN 1 ELSE bucket."count" + 1 END,
      "resetAt" = CASE WHEN bucket."resetAt" <= NOW() THEN NOW() + ${seconds} * INTERVAL '1 second' ELSE bucket."resetAt" END
    RETURNING "count", CEIL(EXTRACT(EPOCH FROM ("resetAt" - NOW())))::integer AS "resetsIn"
  `
  return { allowed: bucket.count <= limit, resetsIn: bucket.resetsIn }
}
