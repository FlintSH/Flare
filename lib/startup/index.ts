import { initializeEventSystem } from '@/lib/events/init'

let startupComplete = false

export async function runStartupTasks() {
  if (startupComplete) {
    return
  }

  try {
    console.log('Running startup tasks...')

    await initializeEventSystem()

    startupComplete = true
    console.log('Startup tasks completed successfully')
  } catch (error) {
    console.error('Startup tasks failed:', error)
  }
}

export function isStartupComplete(): boolean {
  return startupComplete
}
