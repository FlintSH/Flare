import type { Prisma } from '@prisma/client'
import type { InputJsonValue } from '@prisma/client/runtime/library'
import { z } from 'zod'

import {
  DEFAULT_CUSTOMIZATION,
  customizationSchema,
} from '@/lib/customization/schema'
import { prisma } from '@/lib/database/prisma'
import { DEFAULT_EMAIL_CONFIG, emailConfigSchema } from '@/lib/email/schema'
import { loggers } from '@/lib/logger'

const logger = loggers.config

export const configSchema = z.object({
  version: z.string(),
  settings: z.object({
    customization: customizationSchema.prefault({}),
    email: emailConfigSchema.prefault({}),
    general: z.object({
      setup: z.object({
        completed: z.boolean().default(false),
        completedAt: z
          .union([z.date(), z.string()])
          .nullable()
          .transform((val) =>
            val ? (val instanceof Date ? val : new Date(val)) : null
          )
          .default(null),
      }),
      registrations: z.object({
        enabled: z.boolean(),
        disabledMessage: z.string(),
        // Apply only to people who can invite but cannot create users directly.
        inviteLimits: z
          .object({
            activeInvites: z.number().int().min(1).max(100).default(5),
            usesPerInvite: z.number().int().min(1).max(100).default(1),
            lifetimeDays: z.number().int().min(1).max(365).default(30),
          })
          .prefault({}),
      }),
      storage: z.object({
        provider: z.enum(['local', 's3']).default('local'),
        s3: z.object({
          bucket: z.string().default(''),
          region: z.string().default(''),
          accessKeyId: z.string().default(''),
          secretAccessKey: z.string().default(''),
          endpoint: z
            .string()
            .optional()
            .transform((val) => {
              if (!val) return val
              let normalized = val.replace(/\/+$/, '')
              if (!/^https?:\/\//.test(normalized)) {
                normalized = `https://${normalized}`
              }
              return normalized
            }),
          forcePathStyle: z.boolean().default(false),
        }),
        quotas: z.object({
          enabled: z.boolean(),
          default: z.object({
            value: z.number(),
            unit: z.string(),
          }),
        }),
        maxUploadSize: z.object({
          value: z.number(),
          unit: z.string(),
        }),
      }),
      credits: z.object({
        showFooter: z.boolean(),
      }),
      ocr: z.object({
        enabled: z.boolean().default(true),
      }),
      oidc: z
        .object({
          enabled: z.boolean().default(false),
          issuer: z.string().default(''),
          clientId: z.string().default(''),
          clientSecret: z.string().default(''),
          buttonText: z.string().default('Sign in with SSO'),
          autoProvision: z.boolean().default(true),
          requireEmailVerified: z.boolean().default(true),
          enforceSso: z.boolean().default(false),
        })
        .prefault({}),
    }),
    appearance: z.object({
      theme: z.string(),
      favicon: z.string().nullable(),
      customColors: z.record(z.string(), z.string()),
    }),
    advanced: z.object({
      customCSS: z.string(),
      customHead: z.string(),
    }),
  }),
})

export type FlareConfig = z.infer<typeof configSchema>

export const DEFAULT_CONFIG: FlareConfig = {
  version: '1.0.0',
  settings: {
    customization: DEFAULT_CUSTOMIZATION,
    email: DEFAULT_EMAIL_CONFIG,
    general: {
      setup: {
        completed: false,
        completedAt: null,
      },
      registrations: {
        enabled: true,
        disabledMessage: '',
        inviteLimits: {
          activeInvites: 5,
          usesPerInvite: 1,
          lifetimeDays: 30,
        },
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
      oidc: {
        enabled: false,
        issuer: '',
        clientId: '',
        clientSecret: '',
        buttonText: 'Sign in with SSO',
        autoProvision: true,
        requireEmailVerified: true,
        enforceSso: false,
      },
    },
    appearance: {
      theme: 'dark',
      favicon: null,
      customColors: {
        background: '222.2 84% 4.9%',
        foreground: '210 40% 98%',
        card: '222.2 84% 4.9%',
        cardForeground: '210 40% 98%',
        popover: '222.2 84% 4.9%',
        popoverForeground: '210 40% 98%',
        primary: '210 40% 98%',
        primaryForeground: '222.2 47.4% 11.2%',
        secondary: '217.2 32.6% 17.5%',
        secondaryForeground: '210 40% 98%',
        muted: '217.2 32.6% 17.5%',
        mutedForeground: '215 20.2% 65.1%',
        accent: '217.2 32.6% 17.5%',
        accentForeground: '210 40% 98%',
        destructive: '0 62.8% 30.6%',
        destructiveForeground: '210 40% 98%',
        border: '217.2 32.6% 17.5%',
        input: '217.2 32.6% 17.5%',
        ring: '212.7 26.8% 83.9%',
      },
    },
    advanced: {
      customCSS: '',
      customHead: '',
    },
  },
}

export async function initConfig(): Promise<FlareConfig> {
  try {
    const config = await prisma.config.findFirst({
      where: { key: 'flare_config' },
    })

    if (!config) {
      await prisma.config.create({
        data: {
          key: 'flare_config',
          value: DEFAULT_CONFIG as InputJsonValue,
        },
      })
      return DEFAULT_CONFIG
    }

    return configSchema.parse(config.value)
  } catch (error) {
    logger.warn('Could not access database for config, using default', {
      error,
    })
    return DEFAULT_CONFIG
  }
}

const CONFIG_KEY = 'flare_config'

type ConfigRevision = { id: string; xmin: string }
type CachedConfigRow = ConfigRevision & {
  /** The saved JSON as read, deep-frozen. Parse it; never edit it. */
  value: unknown
  parsed?: FlareConfig
  parseError?: unknown
  /** The schema that produced `parsed` or `parseError`. */
  schema?: unknown
}
type ConfigCacheState = {
  row?: CachedConfigRow
  /** One revision query for the calls made in the same event-loop turn. */
  revision?: Promise<ConfigRevision | undefined>
  /** One value read for concurrent calls that found the same new revision. */
  loading?: ConfigRevision & { promise: Promise<CachedConfigRow | null> }
}

// One copy per process, shared by every route bundle that loads this module.
const stateKey = Symbol.for('flare.config.saved-row')
const processState = globalThis as typeof globalThis & {
  [stateKey]?: ConfigCacheState
}
const cache = (processState[stateKey] ??= {})

function sameRevision(
  current: ConfigRevision | undefined,
  revision: ConfigRevision
) {
  return current?.id === revision.id && current.xmin === revision.xmin
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

async function queryRevision(): Promise<ConfigRevision | undefined> {
  const [revision] = await prisma.$queryRaw<ConfigRevision[]>`
    SELECT "id", xmin::text AS "xmin" FROM "Config" WHERE "key" = ${CONFIG_KEY}
  `
  return revision
}

/**
 * The row ID plus PostgreSQL's xmin, which every committed write changes,
 * whichever process or replica made it. Calls made in the same event-loop turn,
 * such as the components of one page, share one query that starts after all of
 * them, so its answer still includes every write committed before any of
 * those calls.
 */
function currentRevision() {
  cache.revision ??= new Promise((resolve, reject) =>
    setImmediate(() => {
      cache.revision = undefined
      queryRevision().then(resolve, reject)
    })
  )
  return cache.revision
}

async function readValue(): Promise<CachedConfigRow | null> {
  // Read the value with its own revision. A write that lands after the
  // revision check is then caught by the next check rather than hidden.
  const [row] = await prisma.$queryRaw<(ConfigRevision & { value: unknown })[]>`
    SELECT "id", xmin::text AS "xmin", "value" FROM "Config" WHERE "key" = ${CONFIG_KEY}
  `
  if (!row) return null
  const next = { id: row.id, xmin: row.xmin, value: deepFreeze(row.value) }
  cache.row = next
  return next
}

/**
 * The saved configuration row, reusing the previous read while its revision
 * matches, so a saved change is seen on the next call without an expiry time
 * or explicit invalidation. Database errors propagate.
 */
export async function readSavedConfigRow(): Promise<CachedConfigRow | null> {
  const revision = await currentRevision()
  if (!revision) {
    cache.row = undefined
    return null
  }
  if (cache.row && sameRevision(cache.row, revision)) return cache.row
  if (!cache.loading || !sameRevision(cache.loading, revision)) {
    const promise: Promise<CachedConfigRow | null> = readValue().finally(() => {
      if (cache.loading?.promise === promise) cache.loading = undefined
    })
    cache.loading = { ...revision, promise }
  }
  return cache.loading.promise
}

function parseSavedConfig(row: CachedConfigRow): FlareConfig {
  // The cache outlives a development reload of this module, which brings a new
  // schema. Results from another schema are stale even if the row isn't.
  if (row.schema !== configSchema) {
    row.parsed = undefined
    row.parseError = undefined
    row.schema = configSchema
  }
  if (row.parsed) return row.parsed
  // The same saved value always fails the same way; report it without re-parsing.
  if (row.parseError) throw row.parseError
  try {
    // Shared by every caller until the row changes, so make it read-only.
    row.parsed = deepFreeze(configSchema.parse(row.value))
    return row.parsed
  } catch (error) {
    row.parseError = error
    throw error
  }
}

export async function getConfig(): Promise<FlareConfig> {
  try {
    const row = await readSavedConfigRow()

    if (!row) {
      return initConfig()
    }

    return parseSavedConfig(row)
  } catch (error) {
    logger.warn('Could not access database for config, using default', {
      error,
    })
    return DEFAULT_CONFIG
  }
}

type ConfigUpdate = {
  version?: string
  settings?: {
    [K in keyof FlareConfig['settings']]?: Partial<FlareConfig['settings'][K]>
  }
}

export async function updateConfig(
  newConfig: ConfigUpdate,
  authorize?: (tx: Prisma.TransactionClient) => Promise<void>,
  validateSaved?: (tx: Prisma.TransactionClient) => Promise<void>
): Promise<FlareConfig> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(721150092)`
      await authorize?.(tx)
      const row = await tx.config.findUnique({ where: { key: 'flare_config' } })
      const currentConfig = row ? configSchema.parse(row.value) : DEFAULT_CONFIG
      const mergedConfig = {
        ...currentConfig,
        ...newConfig,
        settings: {
          ...currentConfig.settings,
          ...(newConfig.settings || {}),
          customization: {
            ...currentConfig.settings.customization,
            ...(newConfig.settings?.customization || {}),
          },
          general: {
            ...currentConfig.settings.general,
            ...(newConfig.settings?.general || {}),
            setup: {
              ...currentConfig.settings.general.setup,
              ...(newConfig.settings?.general?.setup || {}),
            },
            registrations: {
              ...currentConfig.settings.general.registrations,
              ...(newConfig.settings?.general?.registrations || {}),
              inviteLimits: {
                ...currentConfig.settings.general.registrations.inviteLimits,
                ...(newConfig.settings?.general?.registrations?.inviteLimits ||
                  {}),
              },
            },
            storage: {
              ...currentConfig.settings.general.storage,
              ...(newConfig.settings?.general?.storage || {}),
              s3: {
                ...currentConfig.settings.general.storage.s3,
                ...(newConfig.settings?.general?.storage?.s3 || {}),
              },
              quotas: {
                ...currentConfig.settings.general.storage.quotas,
                ...(newConfig.settings?.general?.storage?.quotas || {}),
                default: {
                  ...currentConfig.settings.general.storage.quotas.default,
                  ...(newConfig.settings?.general?.storage?.quotas?.default ||
                    {}),
                },
              },
              maxUploadSize: {
                ...currentConfig.settings.general.storage.maxUploadSize,
                ...(newConfig.settings?.general?.storage?.maxUploadSize || {}),
              },
            },
            credits: {
              ...currentConfig.settings.general.credits,
              ...(newConfig.settings?.general?.credits || {}),
            },
            ocr: {
              ...currentConfig.settings.general.ocr,
              ...(newConfig.settings?.general?.ocr || {}),
            },
            oidc: {
              ...currentConfig.settings.general.oidc,
              ...(newConfig.settings?.general?.oidc || {}),
            },
          },
          appearance: {
            ...currentConfig.settings.appearance,
            ...(newConfig.settings?.appearance || {}),
            customColors: {
              ...currentConfig.settings.appearance.customColors,
              ...(newConfig.settings?.appearance?.customColors || {}),
            },
          },
          advanced: {
            ...currentConfig.settings.advanced,
            ...(newConfig.settings?.advanced || {}),
          },
        },
      }

      const validatedConfig = configSchema.parse(mergedConfig)

      await tx.config.upsert({
        where: { key: 'flare_config' },
        create: {
          key: 'flare_config',
          value: validatedConfig as InputJsonValue,
        },
        update: {
          value: validatedConfig as InputJsonValue,
        },
      })

      await validateSaved?.(tx)
      logger.info('Configuration updated successfully')
      return validatedConfig
    })
  } catch (error) {
    logger.warn('Could not save config to database', { error })
    throw error
  }
}

export async function updateConfigSection<
  T extends keyof FlareConfig['settings'],
>(section: T, data: Partial<FlareConfig['settings'][T]>): Promise<void> {
  try {
    // Pass only the edited section. Reading a whole snapshot here would let a
    // concurrent email save be overwritten after updateConfig acquires its lock.
    await updateConfig({ settings: { [section]: data } })
    logger.debug('Config section updated', { section })
  } catch (error) {
    logger.warn('Could not update config section', { section, error })
    throw error
  }
}
