import type { InputJsonValue } from '@prisma/client/runtime/library'

import { prisma } from '@/lib/database/prisma'

import { DEFAULT_CONFIG, type FlareConfig, configSchema } from '.'

interface Migration {
  version: string
  migrate: (config: FlareConfig) => Promise<FlareConfig>
}

const migrations: Migration[] = [
  {
    version: '1.1.0',
    migrate: async (config: FlareConfig) => {
      // Add OCR settings if they don't exist
      if (!config.settings.general.ocr) {
        config.settings.general.ocr = {
          enabled: true, // Default to enabled for existing installations
        }
      }
      return config
    },
  },
]

export async function migrateConfig() {
  try {
    console.log('Checking for config migrations...')
    const config = await prisma.config.findFirst({
      where: { key: 'flare_config' },
    })

    // If no config exists, create default
    if (!config) {
      console.log('No config found, creating default config...')
      await prisma.config.create({
        data: {
          key: 'flare_config',
          value: DEFAULT_CONFIG as InputJsonValue,
        },
      })
      return
    }

    let currentConfig = configSchema.parse(config.value) as FlareConfig
    const currentVersion = currentConfig.version

    // Find migrations that need to be applied
    const pendingMigrations = migrations.filter(
      (m) => compareVersions(m.version, currentVersion) > 0
    )

    if (pendingMigrations.length === 0) {
      console.log('Config is up to date')
      return
    }

    console.log(`Found ${pendingMigrations.length} pending config migrations`)

    // Apply migrations in order
    for (const migration of pendingMigrations) {
      console.log(
        `Applying config migration to version ${migration.version}...`
      )
      currentConfig = await migration.migrate(currentConfig)
      currentConfig.version = migration.version
    }

    // Validate final config
    const validatedConfig = configSchema.parse(currentConfig)

    // Save migrated config
    await prisma.config.update({
      where: { key: 'flare_config' },
      data: {
        value: validatedConfig as InputJsonValue,
      },
    })

    console.log('Config migrations completed successfully')
  } catch (error) {
    console.error('Failed to migrate config:', error)
    throw error
  }
}

// Simple version comparison utility
function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map(Number)
  const bParts = b.split('.').map(Number)

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aVal = aParts[i] || 0
    const bVal = bParts[i] || 0
    if (aVal !== bVal) return aVal - bVal
  }

  return 0
}
