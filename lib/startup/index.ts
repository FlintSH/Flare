import { initializeEventSystem } from '@/lib/events/init'
import { migrateFilePasswords } from '@/lib/migrations/password-hash'

let startupComplete = false

async function runPasswordMigration() {
  try {
    const result = await migrateFilePasswords()

    if (result.success) {
      if (result.hashedCount && result.hashedCount > 0) {
        console.log(`✅ Password migration: ${result.message}`)
      }
    } else {
      console.error(`❌ Password migration failed: ${result.message}`)
      throw new Error(result.message)
    }
  } catch (error) {
    console.error('Password migration error:', error)
    throw error
  }
}

export async function runStartupTasks() {
  if (startupComplete) {
    return
  }

  try {
    console.log('Running startup tasks...')

    await runPasswordMigration()

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
