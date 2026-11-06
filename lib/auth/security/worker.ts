import { prisma } from '@/lib/database/prisma'
import { createLogger } from '@/lib/logger'
import { startIntervalWorker } from '@/lib/runtime/interval-worker'

import { cleanupSessionHistory } from '../sessions'

const logger = createLogger('security-cleanup')

/** Bounded indexed batches; concurrent processes skip buckets already claimed. */
export async function cleanupExpiredAuthLimits(): Promise<number> {
  return prisma.$executeRaw`
    WITH expired AS MATERIALIZED (
      SELECT "key" FROM "AuthRateLimit"
      WHERE "resetAt" < NOW() - INTERVAL '24 hours'
      ORDER BY "resetAt"
      LIMIT 1000
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM "AuthRateLimit" USING expired
    WHERE "AuthRateLimit"."key" = expired."key"
  `
}

export function startSecurityCleanupWorker() {
  return startIntervalWorker({
    key: 'security-cleanup',
    everyMs: 60_000,
    logger,
    failure: 'Security cleanup unavailable; retrying on the next poll.',
    run: async () => {
      await cleanupExpiredAuthLimits()
      await cleanupSessionHistory()
    },
  })
}
