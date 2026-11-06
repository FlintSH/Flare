import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'

// One saved row served through both the model delegate and raw SQL, so the
// assertions describe behavior rather than which query shape is used.
const db = vi.hoisted(() => ({
  row: null as null | { id: string; xmin: string; value: unknown },
  fail: false,
  valueReads: 0,
  revisionReads: 0,
}))

vi.mock('@/lib/database/prisma', () => {
  const read = () => {
    if (db.fail) throw new Error('database unavailable')
    return db.row
  }
  return {
    prisma: {
      $queryRaw: async (strings: TemplateStringsArray) => {
        const sql = strings.join('?')
        const row = read()
        if (!row) return []
        if (sql.includes('"value"')) {
          db.valueReads++
          return [{ id: row.id, xmin: row.xmin, value: row.value }]
        }
        db.revisionReads++
        return [{ id: row.id, xmin: row.xmin }]
      },
      config: {
        findUnique: async () => {
          const row = read()
          if (!row) return null
          db.valueReads++
          return { id: row.id, key: 'flare_config', value: row.value }
        },
        createMany: async ({ data }: { data: { value: unknown } }) => {
          if (read()) return { count: 0 }
          db.row = { id: 'created', xmin: '1', value: data.value }
          return { count: 1 }
        },
      },
    },
  }
})

const { DEFAULT_CONFIG, configSchema, getConfig, getConfigOrDefaults } =
  await import('@/lib/config')
const { loggers } = await import('@/lib/logger')
const { getEmailConfig, getSavedEmailConfig } =
  await import('@/lib/email/config')

function saved(
  edit: (config: typeof DEFAULT_CONFIG) => void = () => {},
  id = 'row-1',
  xmin = '100'
) {
  const value = structuredClone(DEFAULT_CONFIG)
  value.settings.general.setup.completed = true
  edit(value)
  db.row = { id, xmin, value: JSON.parse(JSON.stringify(value)) }
}

beforeEach(() => {
  vi.restoreAllMocks()
  db.fail = false
  db.valueReads = 0
  db.revisionReads = 0
  saved()
})

describe('configuration revision cache', () => {
  it('parses and transfers the saved value once while its revision is unchanged', async () => {
    // A new revision, so an earlier test's cache can't satisfy this one.
    saved((config) => (config.settings.appearance.theme = 'light'), 'row-a')
    const parse = vi.spyOn(configSchema, 'parse')

    const first = await getConfig()
    const second = await getConfig()
    const third = await getConfig()

    expect(first.settings.appearance.theme).toBe('light')
    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(parse).toHaveBeenCalledTimes(1)
    expect(db.valueReads).toBe(1)
  })

  it('sees an update on the next call, even when only the revision differs', async () => {
    saved((config) => (config.settings.appearance.theme = 'dark'), 'row-b')
    expect((await getConfig()).settings.appearance.theme).toBe('dark')

    // Same ID, same timestamp-free row: the revision alone must invalidate.
    saved(
      (config) => (config.settings.appearance.theme = 'light'),
      'row-b',
      '101'
    )
    expect((await getConfig()).settings.appearance.theme).toBe('light')
  })

  it('treats a replaced row with the same xmin as a different configuration', async () => {
    saved((config) => (config.settings.appearance.theme = 'dark'), 'row-c', '7')
    expect((await getConfig()).settings.appearance.theme).toBe('dark')

    saved(
      (config) => (config.settings.appearance.theme = 'light'),
      'row-d',
      '7'
    )
    expect((await getConfig()).settings.appearance.theme).toBe('light')
  })

  it('returns a frozen object, so no caller can change what others read', async () => {
    saved(undefined, 'row-e')
    const config = await getConfig()

    expect(Object.isFrozen(config)).toBe(true)
    expect(Object.isFrozen(config.settings.general.storage.s3)).toBe(true)
    expect(() => {
      config.settings.general.storage.provider = 's3'
    }).toThrow(TypeError)
    expect((await getConfig()).settings.general.storage.provider).toBe('local')
  })

  it('propagates a database error instead of the defaults, then recovers', async () => {
    saved((config) => (config.settings.appearance.theme = 'light'), 'row-f')
    db.fail = true
    await expect(getConfig()).rejects.toThrow('database unavailable')

    db.fail = false
    expect((await getConfig()).settings.appearance.theme).toBe('light')
  })

  it('creates the default configuration when no row exists', async () => {
    db.row = null
    expect(await getConfig()).toBe(DEFAULT_CONFIG)
    expect(db.row).toMatchObject({ id: 'created' })
  })

  it('parses again with a reloaded schema, as after a development reload', async () => {
    saved((config) => (config.settings.appearance.theme = 'light'), 'row-h')
    await getConfig()
    await getConfig()
    // A reloaded module has a new schema; the process-wide cache survives it.
    vi.resetModules()
    const reloaded = await import('@/lib/config')
    expect(reloaded.configSchema).not.toBe(configSchema)
    const parse = vi.spyOn(reloaded.configSchema, 'parse')

    const config = await reloaded.getConfig()

    expect(parse).toHaveBeenCalledTimes(1)
    expect(config.settings.appearance.theme).toBe('light')
    expect(await reloaded.getConfig()).toBe(config)
    expect(parse).toHaveBeenCalledTimes(1)
  })

  it('throws for an invalid saved configuration without re-parsing it on every call', async () => {
    db.row = { id: 'row-g', xmin: '1', value: { version: 1 } }
    const parse = vi.spyOn(configSchema, 'parse')

    await expect(getConfig()).rejects.toBeInstanceOf(ZodError)
    await expect(getConfig()).rejects.toBeInstanceOf(ZodError)
    expect(parse).toHaveBeenCalledTimes(1)
  })

  it('gives the page shell the defaults, and logs why, only when settings cannot be read', async () => {
    const logged = vi.spyOn(loggers.config, 'warn').mockImplementation(() => {})
    saved((config) => (config.settings.appearance.theme = 'light'), 'row-m')
    expect((await getConfigOrDefaults()).settings.appearance.theme).toBe(
      'light'
    )
    expect(logged).not.toHaveBeenCalled()

    db.fail = true
    expect(await getConfigOrDefaults()).toBe(DEFAULT_CONFIG)
    db.fail = false
    db.row = { id: 'row-n', xmin: '1', value: { version: 1 } }
    expect(await getConfigOrDefaults()).toBe(DEFAULT_CONFIG)
    expect(logged).toHaveBeenCalledTimes(2)
  })

  it('keeps one parse per module copy while copies take turns reading', async () => {
    // Each route bundle loads its own copy of the module; they share the row.
    saved((config) => (config.settings.appearance.theme = 'light'), 'row-o')
    const parse = vi.spyOn(configSchema, 'parse')
    await getConfig()
    vi.resetModules()
    const other = await import('@/lib/config')
    const otherParse = vi.spyOn(other.configSchema, 'parse')

    for (let turn = 0; turn < 3; turn++) {
      expect((await getConfig()).settings.appearance.theme).toBe('light')
      expect((await other.getConfig()).settings.appearance.theme).toBe('light')
    }

    expect(parse).toHaveBeenCalledTimes(1)
    expect(otherParse).toHaveBeenCalledTimes(1)
  })

  it('serves email settings from the same read and still propagates database errors', async () => {
    saved((config) => (config.settings.email.recovery.enabled = false), 'row-h')
    await getConfig()
    const reads = db.valueReads

    expect((await getSavedEmailConfig()).recovery.enabled).toBe(false)
    expect((await getEmailConfig()).recovery.enabled).toBe(false)
    expect(db.valueReads).toBe(reads)

    // Email policy must fail closed rather than fall back to defaults.
    db.fail = true
    await expect(getSavedEmailConfig()).rejects.toThrow('database unavailable')
  })

  it('shares one revision query among calls made in the same turn', async () => {
    saved(undefined, 'row-j')
    await getConfig()
    db.revisionReads = 0
    db.valueReads = 0

    await Promise.all([getConfig(), getConfig(), getSavedEmailConfig()])

    expect(db.revisionReads).toBe(1)
    expect(db.valueReads).toBe(0)
  })

  it('gives a call made after the shared query was sent its own read', async () => {
    saved((config) => (config.settings.appearance.theme = 'dark'), 'row-k')
    await getConfig()
    db.revisionReads = 0
    const first = getConfig()
    // Let the shared revision query go out, then commit a change.
    await new Promise((resolve) => setImmediate(resolve))
    saved(
      (config) => (config.settings.appearance.theme = 'light'),
      'row-k',
      '2'
    )
    const second = getConfig()

    await first
    expect((await second).settings.appearance.theme).toBe('light')
    expect(db.revisionReads).toBe(2)
  })

  it('reads a changed value once for concurrent calls', async () => {
    saved(undefined, 'row-l')
    db.valueReads = 0

    const [first, second] = await Promise.all([getConfig(), getConfig()])

    expect(second).toBe(first)
    expect(db.valueReads).toBe(1)
  })

  it('returns email settings callers can still edit', async () => {
    saved(undefined, 'row-i')
    const email = await getSavedEmailConfig()
    email.verification.mode = 'all_users'
    expect((await getSavedEmailConfig()).verification.mode).toBe('off')
  })
})
