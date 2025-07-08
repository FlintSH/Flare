import { registerFileExpiryHandlers } from './handlers/file-expiry'
import { events } from './index'

let initialized = false

export async function initializeEventSystem() {
  if (initialized) {
    console.log('Event system already initialized')
    return
  }

  try {
    console.log('Initializing event system...')

    await registerFileExpiryHandlers()

    await events.startWorker({
      batchSize: 10,
      pollInterval: 5000,
      maxConcurrency: 3,
      enableScheduledEvents: true,
    })

    initialized = true
    console.log('Event system initialized successfully')

    const stats = await events.getStats()
    console.log('Event queue stats:', stats)
  } catch (error) {
    console.error('Failed to initialize event system:', error)
    throw error
  }
}

export function isEventSystemInitialized(): boolean {
  return initialized
}
