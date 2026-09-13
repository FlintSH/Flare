import { compare } from 'bcryptjs'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

// Exercise bootstrap persistence independently of the per-process HTTP limiter.
vi.mock('@/lib/security/rate-limit', () => ({
  rateLimit: async () => null,
  setupLimiter: {},
}))

const databaseUrl = process.env.FLARE_SETUP_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

suite('setup contracts against disposable PostgreSQL', () => {
  let prisma: typeof import('@/lib/database/prisma').prisma
  let setup: typeof import('@/app/api/setup/route')
  let config: typeof import('@/lib/config')
  let storage: typeof import('@/lib/storage')

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !url.pathname.endsWith('_test')
    )
      throw new Error('Use an explicitly named disposable local _test database')
    vi.stubEnv('DATABASE_URL', databaseUrl!)
    prisma = (await import('@/lib/database/prisma')).prisma
    setup = await import('@/app/api/setup/route')
    config = await import('@/lib/config')
    storage = await import('@/lib/storage')
  })

  beforeEach(async () => {
    await prisma.user.deleteMany()
    await prisma.config.deleteMany()
    storage.invalidateStorageProvider()
  })

  afterAll(async () => {
    storage?.invalidateStorageProvider()
    await prisma?.$disconnect()
    vi.unstubAllEnvs()
  })

  function payload() {
    return {
      admin: {
        name: ' Administrator ',
        email: ' admin@example.test ',
        password: ' setup-test-password ',
      },
      storage: {
        provider: 'local',
        s3: {
          bucket: '',
          region: '',
          accessKeyId: '',
          secretAccessKey: '',
          endpoint: '',
        },
      },
      registrations: { enabled: false, disabledMessage: 'Invitation only' },
    }
  }

  function request(body = payload()) {
    return new Request('http://localhost/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('creates one initial admin with stock appearance and no exposed credentials', async () => {
    const response = await setup.POST(request())
    expect(response.status).toBe(200)
    const user = await prisma.user.findFirstOrThrow()
    expect(user.name).toBe('Administrator')
    expect(user.email).toBe('admin@example.test')
    expect(user.role).toBe('ADMIN')
    expect(user.emailExempt).toBe(true)
    expect(user.emailVerified).toBeNull()
    expect(user.emailVerifiedFor).toBeNull()
    expect(await compare(payload().admin.password, user.password!)).toBe(true)
    expect(await response.json()).toEqual({
      success: true,
      user: { id: user.id, name: 'Administrator', email: 'admin@example.test' },
    })
    const saved = await config.getConfig()
    expect(saved.settings.appearance).toEqual(
      config.DEFAULT_CONFIG.settings.appearance
    )
    expect(saved.settings.customization).toEqual(
      config.DEFAULT_CONFIG.settings.customization
    )
    expect(saved.settings.email.enabled).toBe(false)
    expect(saved.settings.general.setup.completed).toBe(true)
    expect(saved.settings.general.setup.completedAt).toBeInstanceOf(Date)
    expect(saved.settings.general.registrations).toEqual(
      payload().registrations
    )
    expect(saved.settings.general.storage.provider).toBe('local')
  })

  it('rejects repeated bootstrap without replacing the account or settings', async () => {
    expect((await setup.POST(request())).status).toBe(200)
    const before = await prisma.config.findUniqueOrThrow({
      where: { key: 'flare_config' },
    })
    const changed = payload()
    changed.admin.email = 'replacement@example.test'
    changed.registrations.enabled = true
    const response = await setup.POST(request(changed))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Setup already completed' })
    expect(await prisma.user.count()).toBe(1)
    expect((await prisma.user.findFirstOrThrow()).email).toBe(
      'admin@example.test'
    )
    expect(
      await prisma.config.findUniqueOrThrow({ where: { key: 'flare_config' } })
    ).toEqual(before)
  })

  it('serializes simultaneous setup requests with one winning administrator', async () => {
    const first = payload()
    const second = payload()
    second.admin.email = 'other@example.test'
    second.registrations.enabled = true
    const responses = await Promise.all([
      setup.POST(request(first)),
      setup.POST(request(second)),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 400,
    ])
    expect(await prisma.user.count()).toBe(1)
    const winner = await prisma.user.findFirstOrThrow()
    const saved = await config.getConfig()
    expect(saved.settings.general.registrations.enabled).toBe(
      winner.email === 'other@example.test'
    )
  })

  it('rejects missing S3 credentials before creating an administrator', async () => {
    const input = payload()
    input.storage.provider = 's3'
    const response = await setup.POST(request(input))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Bucket name is required',
      field: 'storage.s3.bucket',
    })
    expect(await prisma.user.count()).toBe(0)
    expect(await prisma.config.count()).toBe(0)
  })

  it('replaces pre-setup cached local storage with the saved S3 provider', async () => {
    const previous = await storage.getStorageProvider()
    expect(previous.kind).toBe('local')
    const input = payload()
    input.storage.provider = 's3'
    input.storage.s3 = {
      bucket: 'test-bucket',
      region: 'us-east-1',
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
      endpoint: 'http://127.0.0.1:9000',
    }
    expect((await setup.POST(request(input))).status).toBe(200)
    const current = await storage.getStorageProvider()
    expect(current.kind).toBe('s3')
    expect(current).not.toBe(previous)
    expect(
      (await config.getConfig()).settings.general.storage.s3.forcePathStyle
    ).toBe(false)
  })

  it('rolls back the administrator when saving initial configuration fails', async () => {
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION flare_setup_contract_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'disposable setup test failure'; END; $$`
    )
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER flare_setup_contract_failure BEFORE INSERT OR UPDATE ON "Config" FOR EACH ROW EXECUTE FUNCTION flare_setup_contract_failure()`
    )
    try {
      const response = await setup.POST(request())
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({
        error: 'Failed to complete setup',
      })
      expect(await prisma.user.count()).toBe(0)
      expect(await prisma.config.count()).toBe(0)
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER flare_setup_contract_failure ON "Config"'
      )
      await prisma.$executeRawUnsafe(
        'DROP FUNCTION flare_setup_contract_failure()'
      )
    }
  })
})
