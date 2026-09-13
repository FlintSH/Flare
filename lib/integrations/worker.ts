import { prisma } from '@/lib/database/prisma'
import { createLogger } from '@/lib/logger'

import { claimWebhookDeliveries, deliverWebhook } from './webhooks'

const logger = createLogger('integrations')
const state = globalThis as typeof globalThis & {
  flareWebhookWorker?: {
    timer: NodeJS.Timeout
    busy: boolean
    cleanupAt: number
  }
}

export function startWebhookWorker(): void {
  if (state.flareWebhookWorker) return
  const timer = setInterval(async () => {
    const worker = state.flareWebhookWorker
    if (!worker || worker.busy) return
    worker.busy = true
    try {
      if (worker.cleanupAt <= Date.now()) {
        await prisma.webhookDelivery.deleteMany({
          where: {
            status: { in: ['delivered', 'failed', 'cancelled'] },
            updatedAt: { lt: new Date(Date.now() - 30 * 86_400_000) },
          },
        })
        worker.cleanupAt = Date.now() + 3_600_000
      }
      const deliveries = await claimWebhookDeliveries()
      const results = await Promise.allSettled(deliveries.map(deliverWebhook))
      if (results.some((result) => result.status === 'rejected'))
        logger.warn(
          'A webhook delivery lease will be recovered on a later poll.'
        )
    } catch {
      logger.warn('Webhook processing unavailable; retrying on the next poll.')
    } finally {
      worker.busy = false
    }
  }, 5_000)
  timer.unref()
  state.flareWebhookWorker = { timer, busy: false, cleanupAt: 0 }
}
