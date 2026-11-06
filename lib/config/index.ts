import type { Prisma } from '@prisma/client'
import type { InputJsonValue } from '@prisma/client/runtime/library'
import { z } from 'zod'

import {
  CLASSIC_PALETTE,
  LEGACY_COLOR_MESSAGE,
  MAX_LEGACY_COLORS,
  legacyAppearanceUpdateSchema,
  legacyColors,
  legacyTheme,
} from '@/lib/customization/legacy-appearance'
import { customizationSchema } from '@/lib/customization/schema'
import { lockSettings } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { emailConfigSchema } from '@/lib/email/schema'
import { HttpError } from '@/lib/http/errors'
import { loggers } from '@/lib/logger'
import { storageSettingsSchema } from '@/lib/storage/settings'

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
      // Both values reach inline page markup. Unsafe saved values are dropped
      // rather than rejected, so an old configuration can still be read.
      theme: z.unknown().transform(legacyTheme).prefault('dark'),
      favicon: z.string().nullable(),
      customColors: z.unknown().transform(legacyColors).prefault({}),
    }),
    advanced: z.object({
      customCSS: z.string(),
      customHead: z.string(),
    }),
  }),
})

export type FlareConfig = z.infer<typeof configSchema>

/** A new instance's settings: the schema's defaults plus the values it can't default. */
export const DEFAULT_CONFIG: FlareConfig = configSchema.parse({
  version: '1.0.0',
  settings: {
    general: {
      setup: {},
      registrations: { enabled: true, disabledMessage: '' },
      storage: {
        s3: { endpoint: '' },
        quotas: { enabled: false, default: { value: 10, unit: 'GB' } },
        maxUploadSize: { value: 100, unit: 'MB' },
      },
      credits: { showFooter: true },
      ocr: {},
    },
    appearance: { favicon: null, customColors: CLASSIC_PALETTE },
    advanced: { customCSS: '', customHead: '' },
  },
})

const CONFIG_KEY = 'flare_config'

type ConfigClient = Pick<Prisma.TransactionClient, 'config'>

/**
 * The settings document exactly as stored, or null before anything is saved.
 * Read it in a transaction to see what that transaction will write over.
 */
export async function readSavedConfigValue(
  client: ConfigClient
): Promise<unknown> {
  const row = await client.config.findUnique({ where: { key: CONFIG_KEY } })
  return row ? row.value : null
}

/** The saved settings, or the defaults before anything is saved. Invalid saved settings throw. */
export async function readConfig(client: ConfigClient): Promise<FlareConfig> {
  const value = await readSavedConfigValue(client)
  return value === null ? DEFAULT_CONFIG : configSchema.parse(value)
}

/** Save `config` as the whole settings document, replacing whatever is saved. */
export async function replaceConfig(
  tx: Prisma.TransactionClient,
  config: FlareConfig
): Promise<FlareConfig> {
  await lockSettings(tx)
  const next = configSchema.parse(config)
  await tx.config.upsert({
    where: { key: CONFIG_KEY },
    create: { key: CONFIG_KEY, value: next as InputJsonValue },
    update: { value: next as InputJsonValue },
  })
  return next
}

/**
 * Change the saved settings: takes the settings lock, reads them in `tx`,
 * applies `change` and saves the validated result.
 */
export async function changeConfig(
  tx: Prisma.TransactionClient,
  change: (current: FlareConfig) => FlareConfig
): Promise<FlareConfig> {
  await lockSettings(tx)
  return replaceConfig(tx, change(await readConfig(tx)))
}

/**
 * Replace one section as stored and leave the rest untouched, for a feature
 * that validates its own section and must not depend on the others being valid.
 * Returns false, saving nothing, before any settings are saved.
 */
export async function replaceSavedConfigSection(
  tx: Prisma.TransactionClient,
  section: 'email',
  value: unknown
): Promise<boolean> {
  await lockSettings(tx)
  const saved = (await readSavedConfigValue(tx)) as {
    settings?: Record<string, unknown>
  } | null
  if (!saved) return false
  await tx.config.update({
    where: { key: CONFIG_KEY },
    data: {
      value: {
        ...saved,
        settings: { ...saved.settings, [section]: value },
      } as Prisma.InputJsonValue,
    },
  })
  return true
}

type ConfigRevision = { id: string; xmin: string }
type CachedConfigRow = ConfigRevision & {
  /** The saved JSON as read, deep-frozen. Parse it; never edit it. */
  value: unknown
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

// The row is shared by the whole process, but each route bundle loads its own
// copy of this module, and a development reload brings a new schema, so each
// copy keeps the parse its own schema made.
const parsedRows = new WeakMap<
  CachedConfigRow,
  { config: FlareConfig } | { error: unknown }
>()

function parseSavedConfig(row: CachedConfigRow): FlareConfig {
  let parsed = parsedRows.get(row)
  if (!parsed) {
    try {
      // Shared by every caller until the row changes, so make it read-only.
      parsed = { config: deepFreeze(configSchema.parse(row.value)) }
    } catch (error) {
      // The same saved value always fails the same way; report it without re-parsing.
      parsed = { error }
    }
    parsedRows.set(row, parsed)
  }
  if ('error' in parsed) throw parsed.error
  return parsed.config
}

/**
 * The saved settings, or the defaults before anything is saved. Database
 * errors and a saved document the schema refuses propagate: acting on the
 * defaults instead would, for example, open a closed instance's registration
 * or store uploads on local disk.
 */
export async function getConfig(): Promise<FlareConfig> {
  const row = await readSavedConfigRow()
  if (row) return parseSavedConfig(row)
  // The start script's config migration saves the defaults; this covers a
  // database it hasn't prepared.
  await prisma.config.createMany({
    data: { key: CONFIG_KEY, value: DEFAULT_CONFIG as InputJsonValue },
    skipDuplicates: true,
  })
  return DEFAULT_CONFIG
}

/**
 * The settings, or the defaults when they can't be read. Only for the page
 * shell around every page, which renders outside every error boundary: it
 * must still render so the error page can show.
 */
export async function getConfigOrDefaults(): Promise<FlareConfig> {
  try {
    return await getConfig()
  } catch (error) {
    logger.warn('Could not read settings; page shell uses defaults', { error })
    return DEFAULT_CONFIG
  }
}

type ConfigUpdate = {
  version?: string
  settings?: {
    [K in keyof FlareConfig['settings']]?: Partial<FlareConfig['settings'][K]>
  }
}

export const SETTINGS_NOT_SAVED =
  'Could not update settings. Check the values and try again.'

/** A submitted setting was rejected; the message is safe to show to the person saving. */
export class ConfigValidationError extends HttpError {
  constructor(message = SETTINGS_NOT_SAVED, cause?: unknown) {
    super(400, message, cause === undefined ? {} : { cause })
    this.name = 'ConfigValidationError'
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  )
}

/** Objects merge key by key at every depth; any other submitted value replaces the saved one. */
function mergeSettings<T>(saved: T, update: unknown): T {
  if (!isPlainObject(saved) || !isPlainObject(update)) return update as T
  const merged: Record<string, unknown> = { ...saved }
  for (const [key, value] of Object.entries(update))
    merged[key] = key in saved ? mergeSettings(saved[key], value) : value
  return merged as T
}

/**
 * Merge a partial update into the saved settings inside `tx`. This takes the
 * settings lock, so `tx` may already hold it or the role-change lock, but
 * none of the locks `lib/database/locks.ts` lists after those. Submitted
 * classic colors merge into the saved palette.
 */
export async function applyConfigUpdate(
  tx: Prisma.TransactionClient,
  update: ConfigUpdate
): Promise<FlareConfig> {
  const appearance = update.settings?.appearance
  if (appearance) {
    const submitted = legacyAppearanceUpdateSchema.safeParse(appearance)
    if (!submitted.success)
      throw new ConfigValidationError(
        submitted.error.issues[0]?.message ?? LEGACY_COLOR_MESSAGE
      )
  }
  const saved = await changeConfig(tx, (current) => {
    const merged = mergeSettings(current, update)
    // Reject a merge past the cap, which reads would otherwise trim without telling anyone.
    if (
      appearance?.customColors &&
      Object.keys(merged.settings.appearance.customColors).length >
        MAX_LEGACY_COLORS
    )
      throw new ConfigValidationError(
        `Classic appearance supports at most ${MAX_LEGACY_COLORS} colors, including colors already saved.`
      )
    // The saved settings passed the schema when they were read, so a merge
    // that fails it carries a submitted value the schema refuses.
    const checked = configSchema.safeParse(merged)
    if (!checked.success)
      throw new ConfigValidationError(undefined, checked.error)
    // Check storage as it will be saved: an update sends only what changed,
    // and a blank key keeps the saved one. Saves that leave storage alone
    // don't check it.
    if (update.settings?.general?.storage) {
      const { storage } = checked.data.settings.general
      const usable = storageSettingsSchema.safeParse(storage)
      if (!usable.success)
        throw new ConfigValidationError(usable.error.issues[0].message)
      checked.data.settings.general.storage = {
        ...storage,
        provider: usable.data.provider,
        s3: { ...storage.s3, ...usable.data.s3 },
      }
    }
    const { advanced } = checked.data.settings
    if (update.settings?.advanced?.customCSS !== undefined)
      advanced.customCSS = advanced.customCSS.replace(/\n{3,}/g, '\n\n').trim()
    return checked.data
  })
  logger.info('Configuration updated successfully')
  return saved
}

export async function updateConfig(update: ConfigUpdate): Promise<FlareConfig> {
  return prisma.$transaction((tx) => applyConfigUpdate(tx, update))
}
