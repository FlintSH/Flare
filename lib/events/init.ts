import { loggers } from '@/lib/logger'

import { registerFileExpiryHandlers } from './handlers/file-expiry'
import { events } from './index'

const logger = loggers.events

let initialized = false

export async function initializeEventSystem() {
  if (initialized) {
    logger.debug('Event system already initialized')
    return
  }

  try {
    logger.info('Initializing event system...')

    await registerFileExpiryHandlers()

    await events.startWorker({
      batchSize: 10,
      pollInterval: 5000,
      maxConcurrency: 3,
      enableScheduledEvents: true,
    })

    initialized = true
    logger.info('Event system initialized successfully')

    const stats = await events.getStats()
    logger.info('Event queue stats', { stats })
  } catch (error) {
    logger.error('Failed to initialize event system', error as Error)
    throw error
  }
}

export function isEventSystemInitialized(): boolean {
  return initialized
}
