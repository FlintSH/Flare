import {
  DEFAULT_CONFIG,
  FlareConfig,
  configSchema,
  getConfig,
  initConfig,
  updateConfig,
  updateConfigSection,
} from '@/lib/config'
import { prisma } from '@/lib/database/prisma'

// Mock prisma
jest.mock('@/lib/database/prisma', () => ({
  prisma: {
    config: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
  },
}))

describe('Config Module', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(prisma.config.findFirst as jest.Mock).mockResolvedValue(null)
    ;(prisma.config.findUnique as jest.Mock).mockResolvedValue(null)
    ;(prisma.config.upsert as jest.Mock).mockImplementation(
      async ({ create, update }) => ({
        key: create.key || 'flare_config',
        value: update.value,
      })
    )
  })

  describe('configSchema', () => {
    it('should validate valid config', () => {
      const result = configSchema.safeParse(DEFAULT_CONFIG)
      expect(result.success).toBe(true)
    })

    it('should handle invalid config', () => {
      const invalidConfig = { ...DEFAULT_CONFIG, version: 123 }
      const result = configSchema.safeParse(invalidConfig)
      expect(result.success).toBe(false)
    })

    it('should transform dates correctly', () => {
      const date = new Date()
      const config = {
        ...DEFAULT_CONFIG,
        settings: {
          ...DEFAULT_CONFIG.settings,
          general: {
            ...DEFAULT_CONFIG.settings.general,
            setup: {
              completed: true,
              completedAt: date.toISOString(),
            },
          },
        },
      }
      const result = configSchema.parse(config)
      expect(result.settings.general.setup.completedAt).toBeInstanceOf(Date)
    })

    it('should normalize S3 endpoint URLs', () => {
      const config = {
        ...DEFAULT_CONFIG,
        settings: {
          ...DEFAULT_CONFIG.settings,
          general: {
            ...DEFAULT_CONFIG.settings.general,
            storage: {
              ...DEFAULT_CONFIG.settings.general.storage,
              s3: {
                ...DEFAULT_CONFIG.settings.general.storage.s3,
                endpoint: 'localhost:4566/',
              },
            },
          },
        },
      }
      const result = configSchema.parse(config)
      expect(result.settings.general.storage.s3.endpoint).toBe(
        'https://localhost:4566'
      )
    })
  })

  describe('initConfig', () => {
    it('should create default config if none exists', async () => {
      await initConfig()
      expect(prisma.config.create).toHaveBeenCalledWith({
        data: {
          key: 'flare_config',
          value: DEFAULT_CONFIG,
        },
      })
    })

    it('should return existing config if found', async () => {
      const existingConfig = { ...DEFAULT_CONFIG, version: '1.1.0' }
      ;(prisma.config.findFirst as jest.Mock).mockResolvedValueOnce({
        key: 'flare_config',
        value: existingConfig,
      })

      const result = await initConfig()
      expect(result).toEqual(existingConfig)
      expect(prisma.config.create).not.toHaveBeenCalled()
    })

    it('should handle database errors gracefully', async () => {
      ;(prisma.config.findFirst as jest.Mock).mockRejectedValueOnce(
        new Error('DB Error')
      )
      const result = await initConfig()
      expect(result).toEqual(DEFAULT_CONFIG)
    })
  })

  describe('getConfig', () => {
    it('should return existing config', async () => {
      const existingConfig = { ...DEFAULT_CONFIG, version: '1.1.0' }
      ;(prisma.config.findUnique as jest.Mock).mockResolvedValueOnce({
        key: 'flare_config',
        value: existingConfig,
      })

      const result = await getConfig()
      expect(result).toEqual(existingConfig)
    })

    it('should initialize config if none exists', async () => {
      const result = await getConfig()
      expect(result).toEqual(DEFAULT_CONFIG)
      expect(prisma.config.create).toHaveBeenCalled()
    })

    it('should handle database errors', async () => {
      ;(prisma.config.findUnique as jest.Mock).mockRejectedValueOnce(
        new Error('DB Error')
      )
      const result = await getConfig()
      expect(result).toEqual(DEFAULT_CONFIG)
    })
  })

  describe('updateConfig', () => {
    it('should merge and update config', async () => {
      const existingConfig = { ...DEFAULT_CONFIG }
      ;(prisma.config.findUnique as jest.Mock).mockResolvedValueOnce({
        key: 'flare_config',
        value: existingConfig,
      })

      const update = {
        settings: {
          general: {
            registrations: {
              enabled: false,
              disabledMessage: 'Registrations are closed',
            },
          },
        },
      }

      await updateConfig(update as Partial<FlareConfig>)

      expect(prisma.config.upsert).toHaveBeenCalledWith({
        where: { key: 'flare_config' },
        create: {
          key: 'flare_config',
          value: expect.any(Object),
        },
        update: {
          value: expect.objectContaining({
            settings: expect.objectContaining({
              general: expect.objectContaining({
                registrations: {
                  enabled: false,
                  disabledMessage: 'Registrations are closed',
                },
              }),
            }),
          }),
        },
      })
    })

    it('should handle deep merges correctly', async () => {
      const existingConfig = { ...DEFAULT_CONFIG }
      ;(prisma.config.findUnique as jest.Mock).mockResolvedValueOnce({
        key: 'flare_config',
        value: existingConfig,
      })

      const update = {
        settings: {
          general: {
            storage: {
              quotas: {
                default: {
                  value: 20,
                },
              },
            },
          },
        },
      }

      await updateConfig(update as Partial<FlareConfig>)

      expect(prisma.config.upsert).toHaveBeenCalledWith({
        where: { key: 'flare_config' },
        create: {
          key: 'flare_config',
          value: expect.any(Object),
        },
        update: {
          value: expect.objectContaining({
            settings: expect.objectContaining({
              general: expect.objectContaining({
                storage: expect.objectContaining({
                  quotas: expect.objectContaining({
                    default: expect.objectContaining({
                      value: 20,
                      unit: 'GB', // Original value preserved
                    }),
                  }),
                }),
              }),
            }),
          }),
        },
      })
    })
  })

  describe('updateConfigSection', () => {
    it('should update specific section', async () => {
      const existingConfig = { ...DEFAULT_CONFIG }
      ;(prisma.config.findUnique as jest.Mock).mockResolvedValueOnce({
        key: 'flare_config',
        value: existingConfig,
      })

      const update = {
        theme: 'light',
        customColors: {
          background: '0 0% 100%',
        },
      }

      await updateConfigSection('appearance', update)

      expect(prisma.config.upsert).toHaveBeenCalledWith({
        where: { key: 'flare_config' },
        create: {
          key: 'flare_config',
          value: expect.any(Object),
        },
        update: {
          value: expect.objectContaining({
            settings: expect.objectContaining({
              appearance: expect.objectContaining({
                theme: 'light',
                customColors: expect.objectContaining({
                  background: '0 0% 100%',
                }),
              }),
            }),
          }),
        },
      })
    })

    it('should preserve other sections', async () => {
      const existingConfig = { ...DEFAULT_CONFIG }
      ;(prisma.config.findUnique as jest.Mock).mockResolvedValueOnce({
        key: 'flare_config',
        value: existingConfig,
      })

      const update = {
        customCSS: 'body { color: red; }',
      }

      await updateConfigSection('advanced', update)

      expect(prisma.config.upsert).toHaveBeenCalledWith({
        where: { key: 'flare_config' },
        create: {
          key: 'flare_config',
          value: expect.any(Object),
        },
        update: {
          value: expect.objectContaining({
            settings: expect.objectContaining({
              advanced: expect.objectContaining({
                customCSS: 'body { color: red; }',
                customHead: '', // Original value preserved
              }),
            }),
          }),
        },
      })
    })
  })
})
