import { prisma } from '@/lib/database/prisma'
import { createLogger } from '@/lib/logger'

import { getEmailConfig } from './config'
import { claimMail, cleanupMail, deliverClaimedMail } from './outbox'

const logger = createLogger('email')
const state = globalThis as typeof globalThis & {
  flareMailWorker?: { timer: NodeJS.Timeout; busy: boolean; cleanupAt: number }
}

/** Shared startup hook; each process may run it because claims are database-atomic. */
export function startMailWorker(): void {
  if (state.flareMailWorker) return
  const timer = setInterval(async () => {
    const worker = state.flareMailWorker
    if (!worker || worker.busy) return
    worker.busy = true
    try {
      const config = await getEmailConfig()
      if (worker.cleanupAt <= Date.now()) {
        await cleanupMail(config)
        worker.cleanupAt = Date.now() + 60_000
      }
      if (!config.enabled) {
        // Revoked messages must not spring back to life when delivery is re-enabled.
        await prisma.mailOutbox.updateMany({
          where: {
            OR: [
              { status: { in: ['pending', 'failed'] } },
              { status: 'processing', leaseUntil: { lte: new Date() } },
            ],
          },
          data: {
            status: 'cancelled',
            payload: '',
            leaseId: null,
            leaseUntil: null,
            lastError: 'Email delivery was disabled.',
          },
        })
      } else {
        const mail = await claimMail(config)
        const results = await Promise.allSettled(
          mail.map((item) => deliverClaimedMail(item, config))
        )
        if (results.some((result) => result.status === 'rejected')) {
          logger.warn(
            'Some email claims could not be completed; their leases will be recovered.'
          )
        }
      }
    } catch {
      // Error objects can contain SQL parameters and message payloads.
      logger.warn(
        'Email worker could not process mail; it will retry on the next poll.'
      )
    } finally {
      worker.busy = false
    }
  }, 5_000)
  timer.unref()
  state.flareMailWorker = { timer, busy: false, cleanupAt: 0 }
}

export function stopMailWorker(): void {
  if (!state.flareMailWorker) return
  clearInterval(state.flareMailWorker.timer)
  delete state.flareMailWorker
}
