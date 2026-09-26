import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

const authentication = vi.hoisted(() => ({ id: '' }))
vi.mock('@/lib/auth/api-auth', () => ({
  requireAuth: async () => ({
    user: { id: authentication.id },
    response: null,
  }),
}))

const databaseUrl = process.env.FLARE_EMAIL_CONFIG_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

suite('email configuration against disposable PostgreSQL', () => {
  let prisma: typeof import('@/lib/database/prisma').prisma
  let configModule: typeof import('@/lib/email/config')
  let appConfig: typeof import('@/lib/config')
  let schema: typeof import('@/lib/email/schema')
  let profile: typeof import('@/app/api/profile/route')
  let accountModule: typeof import('@/lib/email/account')

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !url.pathname.endsWith('_test')
    )
      throw new Error('Use an explicitly named disposable local _test database')
    vi.stubEnv('DATABASE_URL', databaseUrl!)
    vi.stubEnv('NEXTAUTH_SECRET', 'public-disposable-config-test-secret-2026')
    prisma = (await import('@/lib/database/prisma')).prisma
    configModule = await import('@/lib/email/config')
    appConfig = await import('@/lib/config')
    schema = await import('@/lib/email/schema')
    profile = await import('@/app/api/profile/route')
    accountModule = await import('@/lib/email/account')
  })
  beforeEach(async () => {
    await prisma.mailOutbox.deleteMany()
    await prisma.user.deleteMany()
    await prisma.config.deleteMany()
    await prisma.config.create({
      data: {
        key: 'flare_config',
        value: structuredClone(appConfig.DEFAULT_CONFIG),
      },
    })
  })
  afterEach(() => vi.restoreAllMocks())
  afterAll(async () => {
    await prisma?.$disconnect()
    vi.unstubAllEnvs()
  })

  function workingConfig() {
    return schema.emailConfigSchema.parse({
      enabled: true,
      smtp: {
        host: 'smtp.example.test',
        username: 'test',
        password: 'smtp-private-password',
      },
      fromAddress: 'flare@example.test',
      publicUrl: 'https://flare.example.test',
    })
  }

  it('stores encrypted credentials and exposes only configured state, including while disabled', async () => {
    const input = workingConfig()
    const result = await configModule.saveEmailConfig(input)
    expect(result.config.smtp.password).toBe('')
    expect(result.passwordConfigured).toBe(true)
    const saved = await configModule.getSavedEmailConfig()
    expect(saved.smtp.password).toMatch(/^flare-email:v1:/)
    expect(JSON.stringify(saved)).not.toContain('smtp-private-password')
    expect((await configModule.getEmailConfig()).smtp.password).toBe(
      'smtp-private-password'
    )
    await configModule.saveEmailConfig({ ...result.config, enabled: false })
    expect((await configModule.getEmailSettingsView()).passwordConfigured).toBe(
      true
    )
  })

  it('preserves the saved password on blank input and does not save invalid clear requests', async () => {
    const view = await configModule.saveEmailConfig(workingConfig())
    await configModule.saveEmailConfig({
      ...view.config,
      fromName: 'Updated sender',
    })
    expect((await configModule.getEmailConfig()).smtp.password).toBe(
      'smtp-private-password'
    )
    await expect(
      configModule.saveEmailConfig(view.config, { clearPassword: true })
    ).rejects.toThrow('password')
    expect((await configModule.getEmailConfig()).smtp.password).toBe(
      'smtp-private-password'
    )
  })

  it('sets policy boundaries server-side and never treats old verification timestamps as ownership', async () => {
    await prisma.user.create({
      data: {
        email: 'legacy@example.test',
        emailVerified: new Date(),
        roles: { connect: { systemKey: 'administrator' } },
        password: 'fixture-only',
        urlId: 'legacy',
        uploadToken: 'legacy-test-token',
        createdAt: new Date('2020-01-01'),
      },
    })
    const input = workingConfig()
    input.verification.mode = 'new_users'
    input.verification.requiredSince = '2000-01-01T00:00:00.000Z'
    const view = await configModule.saveEmailConfig(input)
    expect(
      new Date(view.config.verification.requiredSince!).getFullYear()
    ).toBeGreaterThan(2020)
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'legacy@example.test' },
    })
    expect(user.emailVerifiedFor).toBeNull()
    expect(user.emailVerificationSource).toBeNull()
  })

  it('requires explicit existing-user enrollment and preserves administrator recovery access', async () => {
    const input = workingConfig()
    input.verification.mode = 'all_users'
    await expect(configModule.saveEmailConfig(input)).rejects.toThrow('confirm')
    await expect(
      configModule.saveEmailConfig(input, { applyToExisting: true })
    ).rejects.toThrow('administrator')
    await prisma.user.create({
      data: {
        email: 'admin@example.test',
        emailExempt: true,
        roles: { connect: { systemKey: 'administrator' } },
        password: 'fixture-only',
        urlId: 'admin',
        uploadToken: 'admin-test-token',
      },
    })
    const view = await configModule.saveEmailConfig(input, {
      applyToExisting: true,
    })
    expect(view.config.verification.graceEndsAt).toBeTruthy()
  })

  it('serializes independent email and appearance writes without losing either change', async () => {
    await Promise.all([
      configModule.saveEmailConfig(workingConfig()),
      appConfig.updateConfigSection('appearance', { theme: 'light' }),
    ])
    const actual = await appConfig.getConfig()
    expect(actual.settings.appearance.theme).toBe('light')
    expect(actual.settings.email.enabled).toBe(true)
  })

  it('records environment-only policy transitions without persisting the overrides', async () => {
    await configModule.saveEmailConfig({ ...workingConfig(), enabled: false })
    vi.stubEnv('FLARE_EMAIL_ENABLED', 'true')
    vi.stubEnv('FLARE_EMAIL_VERIFICATION_MODE', 'new_users')
    vi.stubEnv('FLARE_EMAIL_VERIFICATION_TRUST_OIDC', 'true')
    try {
      const first = await configModule.getEmailConfig()
      expect(first.verification.requiredSince).toBeTruthy()
      vi.stubEnv('FLARE_EMAIL_VERIFICATION_MODE', 'all_users')
      expect(
        (await configModule.getEmailConfig()).verification.graceEndsAt
      ).toBeTruthy()
      const saved = await configModule.getSavedEmailConfig()
      expect(saved.enabled).toBe(false)
      expect(saved.verification.mode).toBe('off')
      expect(saved.verification.trustOidc).toBe(false)
    } finally {
      delete process.env.FLARE_EMAIL_ENABLED
      delete process.env.FLARE_EMAIL_VERIFICATION_MODE
      delete process.env.FLARE_EMAIL_VERIFICATION_TRUST_OIDC
    }
    expect((await configModule.getEmailConfig()).enabled).toBe(false)
    expect(
      (await configModule.getSavedEmailConfig()).verification.appliedMode
    ).toBe('off')
  })

  function deferred() {
    let resolve!: () => void
    const promise = new Promise<void>((done) => {
      resolve = done
    })
    return { promise, resolve }
  }

  async function profileAccount() {
    const { hash } = await import('bcryptjs')
    const account = await prisma.user.create({
      data: {
        email: 'profile@example.test',
        password: await hash('old-password', 10),
        urlId: 'profile-user',
        uploadToken: 'profile-test-token',
      },
    })
    authentication.id = account.id
    return account
  }

  function profileRequest(body: object) {
    return new Request('https://flare.example.test/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('rejects a direct profile address change when email is enabled after its initial policy read', async () => {
    const account = await profileAccount()
    const waiting = deferred()
    const resume = deferred()
    const readPolicy = configModule.getEmailConfigForUpdate
    vi.spyOn(configModule, 'getEmailConfigForUpdate').mockImplementationOnce(
      async (tx) => {
        waiting.resolve()
        await resume.promise
        return readPolicy(tx)
      }
    )
    const update = profile.PUT(
      profileRequest({ email: 'unconfirmed@example.test' })
    )
    await waiting.promise
    try {
      await configModule.saveEmailConfig(workingConfig())
    } finally {
      resume.resolve()
    }
    const response = await update
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('verified email change'),
    })
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).email
    ).toBe(account.email)
  })

  it('holds policy activation until an in-flight legacy profile change commits', async () => {
    const account = await profileAccount()
    const waiting = deferred()
    const resume = deferred()
    const lockUser = accountModule.lockEmailUser
    vi.spyOn(accountModule, 'lockEmailUser').mockImplementationOnce(
      async (tx, id) => {
        waiting.resolve()
        await resume.promise
        return lockUser(tx, id)
      }
    )
    const update = profile.PUT(
      profileRequest({ email: 'legacy-change@example.test' })
    )
    await waiting.promise
    const activation = configModule.saveEmailConfig(workingConfig())
    try {
      await vi.waitFor(
        async () => {
          const locks = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
          SELECT EXISTS (
            SELECT 1 FROM pg_locks
            WHERE locktype = 'advisory' AND objid = 721150092 AND NOT granted
          ) AS waiting`
          expect(locks[0].waiting).toBe(true)
        },
        { timeout: 1500, interval: 10 }
      )
    } finally {
      resume.resolve()
      await Promise.allSettled([update, activation])
    }
    expect((await update).status).toBe(200)
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).email
    ).toBe('legacy-change@example.test')
    expect((await configModule.getEmailConfig()).enabled).toBe(true)
  })

  it('uses newly enabled policy for password-change session invalidation', async () => {
    const account = await profileAccount()
    const waiting = deferred()
    const resume = deferred()
    const readPolicy = configModule.getEmailConfigForUpdate
    vi.spyOn(configModule, 'getEmailConfigForUpdate').mockImplementationOnce(
      async (tx) => {
        waiting.resolve()
        await resume.promise
        return readPolicy(tx)
      }
    )
    const update = profile.PUT(
      profileRequest({
        currentPassword: 'old-password',
        newPassword: 'updated-password',
      })
    )
    await waiting.promise
    try {
      await configModule.saveEmailConfig(workingConfig())
    } finally {
      resume.resolve()
    }
    expect((await update).status).toBe(200)
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: account.id } }))
        .sessionVersion
    ).toBe(account.sessionVersion + 1)
  })
})
