import { startAuditRetentionWorker } from '@/lib/audit/retention'
import { startSecurityCleanupWorker } from '@/lib/auth/security/worker'
import { startMailWorker } from '@/lib/email/worker'
import { startFileEncryptionWorker } from '@/lib/files/existing-worker'
import { startFileExpiryWorker } from '@/lib/files/expiry-worker'
import { CORS_ENV, corsWarnings } from '@/lib/http/cors'
import { startWebhookWorker } from '@/lib/integrations/worker'
import { loggers } from '@/lib/logger'
import { startStorageDeletionWorker } from '@/lib/storage/deletion-worker'
import { startOcrTagWorker } from '@/lib/tags/worker'

import { startMemoryMonitor } from './memory-monitor'
import { sessionSecretWarnings } from './secrets'

const logger = loggers.startup

function warnAboutSessionSecret() {
  for (const warning of sessionSecretWarnings(process.env.NEXTAUTH_SECRET))
    logger.warn(warning)
}

function warnAboutCorsOrigins() {
  for (const warning of corsWarnings(process.env[CORS_ENV]))
    logger.warn(warning)
}

/**
 * Starts each task on its own, so one that throws can't keep the others from
 * starting. Workers are process-wide singletons: a second call starts none twice.
 */
export async function runStartupTasks() {
  const startTime = Date.now()
  logger.info('Running startup tasks...')

  const tasks: [name: string, start: () => unknown][] = [
    ['session secret check', warnAboutSessionSecret],
    ['CORS origin check', warnAboutCorsOrigins],
    ['security cleanup', startSecurityCleanupWorker],
    ['audit retention', startAuditRetentionWorker],
    ['storage deletion', startStorageDeletionWorker],
    ['file expiry', startFileExpiryWorker],
    ['encryption of existing files', startFileEncryptionWorker],
    ['email delivery', startMailWorker],
    ['webhook delivery', startWebhookWorker],
    ['OCR tag retries', startOcrTagWorker],
  ]
  if (process.env.NODE_ENV === 'production')
    tasks.push(['memory monitor', startMemoryMonitor])

  let failed = false
  for (const [task, start] of tasks) {
    try {
      start()
    } catch (error) {
      failed = true
      logger.error('Startup tasks failed', error, { task })
    }
  }
  if (!failed)
    logger.info('Startup tasks completed successfully', {
      duration: Date.now() - startTime,
    })
}
