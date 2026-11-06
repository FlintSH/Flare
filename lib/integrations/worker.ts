import { prisma } from '@/lib/database/prisma'
import { createLogger } from '@/lib/logger'
import { startIntervalWorker } from '@/lib/runtime/interval-worker'

import { claimWebhookDeliveries, deliverWebhook } from './webhooks'

const logger = createLogger('integrations')

export function startWebhookWorker() {
  let cleanupAt = 0
  return startIntervalWorker({
    key: 'webhooks',
    everyMs: 5_000,
    logger,
    failure: 'Webhook processing unavailable; retrying on the next poll.',
    run: async () => {
      if (cleanupAt <= Date.now()) {
        await prisma.webhookDelivery.deleteMany({
          where: {
            status: { in: ['delivered', 'failed', 'cancelled'] },
            updatedAt: { lt: new Date(Date.now() - 30 * 86_400_000) },
          },
        })
        cleanupAt = Date.now() + 3_600_000
      }
      const deliveries = await claimWebhookDeliveries()
      const results = await Promise.allSettled(deliveries.map(deliverWebhook))
      if (results.some((result) => result.status === 'rejected'))
        logger.warn(
          'A webhook delivery lease will be recovered on a later poll.'
        )
    },
  })
}
