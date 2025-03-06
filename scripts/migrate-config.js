/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const DEFAULT_CONFIG = {
  version: '1.1.0',
  settings: {
    general: {
      setup: {
        completed: false,
        completedAt: null,
      },
      registrations: {
        enabled: true,
        disabledMessage: '',
      },
      storage: {
        provider: 'local',
        s3: {
          bucket: '',
          region: '',
          accessKeyId: '',
          secretAccessKey: '',
          endpoint: '',
          forcePathStyle: false,
        },
        quotas: {
          enabled: false,
          default: {
            value: 10,
            unit: 'GB',
          },
        },
        maxUploadSize: {
          value: 100,
          unit: 'MB',
        },
      },
      credits: {
        showFooter: true,
      },
      ocr: {
        enabled: true,
      },
    },
    appearance: {
      theme: 'dark',
      favicon: null,
      customColors: {
        card: '222.2 84% 4.9%',
        ring: '212.7 26.8% 83.9%',
        input: '217.2 32.6% 17.5%',
        muted: '217.2 32.6% 17.5%',
        accent: '217.2 32.6% 17.5%',
        border: '217.2 32.6% 17.5%',
        popover: '222.2 84% 4.9%',
        primary: '210 40% 98%',
        secondary: '217.2 32.6% 17.5%',
        background: '222.2 84% 4.9%',
        foreground: '210 40% 98%',
        destructive: '0 62.8% 30.6%',
        cardForeground: '210 40% 98%',
        mutedForeground: '215 20.2% 65.1%',
        accentForeground: '210 40% 98%',
        popoverForeground: '210 40% 98%',
        primaryForeground: '222.2 47.4% 11.2%',
        secondaryForeground: '210 40% 98%',
        destructiveForeground: '210 40% 98%',
      },
    },
    advanced: {
      customCSS: '',
      customHead: '',
    },
  },
}

async function migrateConfig() {
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
          value: DEFAULT_CONFIG,
        },
      })
      console.log('Created default config')
      return
    }

    // Add OCR settings if they don't exist
    const currentConfig = config.value
    if (!currentConfig.settings?.general?.ocr) {
      currentConfig.settings.general.ocr = {
        enabled: true,
      }
      currentConfig.version = '1.1.0'

      await prisma.config.update({
        where: { key: 'flare_config' },
        data: {
          value: currentConfig,
        },
      })
      console.log('Added OCR settings to config')
    }

    console.log('Config migrations completed successfully')
  } catch (error) {
    console.error('Failed to migrate config:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

migrateConfig().catch(console.error)
