import { auditContext } from '@/lib/audit/context'
import { prisma } from '@/lib/database/prisma'
import { createLogger } from '@/lib/logger'

import { cleanupSessionHistory } from '../sessions'

const logger = createLogger('security-cleanup')
const state = globalThis as typeof globalThis & {
  flareSecurityCleanup?: { timer: NodeJS.Timeout; busy: boolean }
}

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

export function startSecurityCleanupWorker(): void {
  if (state.flareSecurityCleanup) return
  const timer = setInterval(
    () =>
      auditContext.run({ actorId: null, actorName: 'System' }, async () => {
        const worker = state.flareSecurityCleanup
        if (!worker || worker.busy) return
        worker.busy = true
        try {
          await cleanupExpiredAuthLimits()
          await cleanupSessionHistory()
        } catch {
          // Keep database connection details and bucket identifiers out of logs.
          logger.warn(
            'Security cleanup unavailable; retrying on the next poll.'
          )
        } finally {
          worker.busy = false
        }
      }),
    60_000
  )
  timer.unref()
  state.flareSecurityCleanup = { timer, busy: false }
}
