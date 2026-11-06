import { prisma } from '@/lib/database/prisma'
import { createLogger } from '@/lib/logger'
import { startIntervalWorker } from '@/lib/runtime/interval-worker'

import { getEmailConfig } from './config'
import { claimMail, cleanupMail, deliverClaimedMail } from './outbox'

const logger = createLogger('email')

/** Every process may run it because claims are database-atomic. */
export function startMailWorker() {
  let cleanupAt = 0
  return startIntervalWorker({
    key: 'mail',
    everyMs: 5_000,
    logger,
    failure:
      'Email worker could not process mail; it will retry on the next poll.',
    run: async () => {
      const config = await getEmailConfig()
      if (cleanupAt <= Date.now()) {
        await cleanupMail(config)
        cleanupAt = Date.now() + 60_000
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
    },
  })
}
