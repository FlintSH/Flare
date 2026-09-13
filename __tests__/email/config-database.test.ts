import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

const databaseUrl = process.env.FLARE_EMAIL_CONFIG_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

suite('email configuration against disposable PostgreSQL', () => {
  let prisma: typeof import('@/lib/database/prisma').prisma
  let configModule: typeof import('@/lib/email/config')
  let appConfig: typeof import('@/lib/config')
  let schema: typeof import('@/lib/email/schema')

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
        role: 'ADMIN',
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
        role: 'ADMIN',
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
})
