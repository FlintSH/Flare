import { DEFAULT_CONFIG } from '@/lib/config'
import { migrateConfig } from '@/lib/config/migrate'
import { prisma } from '@/lib/database/prisma'

// Mock prisma
jest.mock('@/lib/database/prisma', () => ({
  prisma: {
    config: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}))

describe('Config Migration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(prisma.config.findFirst as jest.Mock).mockResolvedValue(null)
  })

  describe('migrateConfig', () => {
    it('should create default config if none exists', async () => {
      await migrateConfig()

      expect(prisma.config.create).toHaveBeenCalledWith({
        data: {
          key: 'flare_config',
          value: DEFAULT_CONFIG,
        },
      })
      expect(prisma.config.update).not.toHaveBeenCalled()
    })

    it('should apply pending migrations', async () => {
      const oldConfig = {
        ...DEFAULT_CONFIG,
        version: '1.0.0',
        settings: {
          ...DEFAULT_CONFIG.settings,
          general: {
            ...DEFAULT_CONFIG.settings.general,
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
            // OCR settings will be added by migration
          },
          appearance: DEFAULT_CONFIG.settings.appearance,
          advanced: DEFAULT_CONFIG.settings.advanced,
        },
      }

      ;(prisma.config.findFirst as jest.Mock).mockResolvedValueOnce({
        key: 'flare_config',
        value: oldConfig,
      })

      await migrateConfig()

      expect(prisma.config.update).toHaveBeenCalledWith({
        where: { key: 'flare_config' },
        data: {
          value: expect.objectContaining({
            version: '1.1.0',
            settings: expect.objectContaining({
              general: expect.objectContaining({
                ocr: {
                  enabled: true,
                },
              }),
            }),
          }),
        },
      })
    })

    it('should handle up-to-date config', async () => {
      const currentConfig = {
        ...DEFAULT_CONFIG,
        version: '1.1.0',
      }

      ;(prisma.config.findFirst as jest.Mock).mockResolvedValueOnce({
        key: 'flare_config',
        value: currentConfig,
      })

      await migrateConfig()

      expect(prisma.config.update).not.toHaveBeenCalled()
    })

    it('should handle database errors', async () => {
      ;(prisma.config.findFirst as jest.Mock).mockRejectedValueOnce(
        new Error('DB Error')
      )

      await expect(migrateConfig()).rejects.toThrow('DB Error')
    })

    it('should validate migrated config', async () => {
      const invalidConfig = {
        ...DEFAULT_CONFIG,
        version: '1.0.0',
        settings: {
          ...DEFAULT_CONFIG.settings,
          general: {
            ...DEFAULT_CONFIG.settings.general,
            ocr: {
              enabled: 'not-a-boolean', // Invalid type
            },
          },
        },
      }

      ;(prisma.config.findFirst as jest.Mock).mockResolvedValueOnce({
        key: 'flare_config',
        value: invalidConfig,
      })

      await expect(migrateConfig()).rejects.toThrow()
    })
  })

  describe('version comparison', () => {
    it('should handle major version differences', async () => {
      const oldConfig = {
        ...DEFAULT_CONFIG,
        version: '1.0.0',
      }

      ;(prisma.config.findFirst as jest.Mock).mockResolvedValueOnce({
        key: 'flare_config',
        value: oldConfig,
      })

      await migrateConfig()

      expect(prisma.config.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            value: expect.objectContaining({
              version: '1.1.0',
            }),
          }),
        })
      )
    })

    it('should handle minor version differences', async () => {
      const oldConfig = {
        ...DEFAULT_CONFIG,
        version: '1.0.5',
      }

      ;(prisma.config.findFirst as jest.Mock).mockResolvedValueOnce({
        key: 'flare_config',
        value: oldConfig,
      })

      await migrateConfig()

      expect(prisma.config.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            value: expect.objectContaining({
              version: '1.1.0',
            }),
          }),
        })
      )
    })

    it('should handle patch version differences', async () => {
      const oldConfig = {
        ...DEFAULT_CONFIG,
        version: '1.1.0',
      }

      ;(prisma.config.findFirst as jest.Mock).mockResolvedValueOnce({
        key: 'flare_config',
        value: oldConfig,
      })

      await migrateConfig()

      // No update needed for same version
      expect(prisma.config.update).not.toHaveBeenCalled()
    })
  })
})
