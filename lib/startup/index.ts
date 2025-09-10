import { initializeEventSystem } from '@/lib/events/init'
import { loggers } from '@/lib/logger'

const logger = loggers.startup

let startupComplete = false

export async function runStartupTasks() {
  if (startupComplete) {
    return
  }

  const startTime = Date.now()

  try {
    logger.info('Running startup tasks...')

    await initializeEventSystem()

    startupComplete = true
    const duration = Date.now() - startTime
    logger.info('Startup tasks completed successfully', { duration })
  } catch (error) {
    logger.error('Startup tasks failed', error as Error)
  }
}

export function isStartupComplete(): boolean {
  return startupComplete
}
