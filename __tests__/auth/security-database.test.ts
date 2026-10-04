import { hash } from 'bcryptjs'
import type { Session } from 'next-auth'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { securityTestDatabaseUrl } from './security-database-guard'

const databaseUrl = process.env.FLARE_SECURITY_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

suite('account security against disposable PostgreSQL', () => {
  let prisma: typeof import('@/lib/database/prisma').prisma
  let service: typeof import('@/lib/auth/security/service')
  let crypto: typeof import('@/lib/auth/security/crypto')
  let shared: typeof import('@/lib/auth/security/shared')
  let passkeys: typeof import('@/lib/auth/security/passkeys')
  let auth: typeof import('@/lib/auth')
  let required: typeof import('@/lib/auth/security/required-passkeys')
  let password: string
  const session = (
    version = 1,
    method = 'credentials',
    authTime = Date.now()
  ): Session => ({
    expires: new Date(Date.now() + 3600000).toISOString(),
    user: {
      id: 'security-owner',
      name: 'Security test',
      email: 'test@example.invalid',
      image: null,
      roles: [],
      permissions: [],
      sessionVersion: version,
      authMethod: method,
      authTime,
    },
  })

  beforeAll(async () => {
    const url = securityTestDatabaseUrl(databaseUrl!)
    vi.stubEnv('DATABASE_URL', url.toString())
    vi.stubEnv('NEXTAUTH_SECRET', 'disposable-security-test-key-32-characters')
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000')
    prisma = (await import('@/lib/database/prisma')).prisma
    service = await import('@/lib/auth/security/service')
    crypto = await import('@/lib/auth/security/crypto')
    shared = await import('@/lib/auth/security/shared')
    passkeys = await import('@/lib/auth/security/passkeys')
    auth = await import('@/lib/auth')
    required = await import('@/lib/auth/security/required-passkeys')
    password = await hash('correct test password', 4)
  })
  beforeEach(async () => {
    await prisma.config.deleteMany({ where: { key: 'flare_config' } })
    await prisma.authChallenge.deleteMany()
    await prisma.authRateLimit.deleteMany()
    await prisma.user.deleteMany()
    await prisma.user.create({
      data: {
        id: 'security-owner',
        email: 'test@example.invalid',
        password,
        urlId: 'security-owner',
        uploadToken: 'security-token',
      },
    })
  })
  afterAll(async () => {
    await prisma?.$disconnect()
    vi.unstubAllEnvs()
  })

  async function enroll() {
    const setup = await service.setupTotp(session(), {
      password: 'correct test password',
    })
    const code = crypto.createTotp(setup.secret).generate()
    const result = await service.enableTotp(session(), code, setup.challengeId)
    return { ...setup, ...result, code }
  }
  async function redeem(code: string) {
    return prisma.$transaction(async (tx) => {
      const user = await shared.lockSecurityUser(tx, 'security-owner')
      await service.consumeSecondFactor(tx, user, code)
    })
  }

  async function addPasskey(id = 'primary-passkey') {
    return prisma.passkey.create({
      data: {
        id,
        userId: 'security-owner',
        name: id,
        publicKey: new Uint8Array([1]),
        counter: 0,
        transports: [],
      },
    })
  }
  function authorizeProvider(id = 'credentials') {
    const provider = auth.authOptions.providers.find((item) => {
      const value = item as unknown as { id: string; options?: { id?: string } }
      return (value.options?.id || value.id) === id
    }) as unknown as {
      options: {
        authorize: (
          credentials: Record<string, string>,
          req: { headers: Record<string, string> }
        ) => Promise<Record<string, unknown> | null>
      }
    }
    return (credentials: Record<string, string>) =>
      provider.options.authorize(credentials, { headers: {} })
  }
  async function requirePasskey(version = 1) {
    await addPasskey()
    return required.setPasskeyRequired(session(version, 'passkey'), true)
  }

  it('keeps enrollment optional until a fresh passkey explicitly enables required mode', async () => {
    await addPasskey()
    expect(
      await authorizeProvider()({
        email: 'test@example.invalid',
        password: 'correct test password',
      })
    ).toMatchObject({ id: 'security-owner' })
    for (const method of [
      'credentials',
      'oidc',
      'recovery',
      'passkey-recovery',
    ]) {
      await expect(
        required.setPasskeyRequired(session(1, method), true)
      ).rejects.toThrow('Sign in again with a passkey')
    }
    const result = await required.setPasskeyRequired(
      session(1, 'passkey'),
      true
    )
    expect(result.recoveryCodes).toHaveLength(10)
    expect(
      result.recoveryCodes!.every((code) =>
        /^[a-f0-9]{8}(?:-[a-f0-9]{8}){3}$/.test(code)
      )
    ).toBe(true)
    expect(await prisma.passkeyRecoveryCode.count()).toBe(10)
    expect(await prisma.recoveryCode.count()).toBe(0)
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: 'security-owner' },
    })
    expect(stored).toMatchObject({ passkeyRequired: true, sessionVersion: 2 })
    expect(
      JSON.stringify(await prisma.passkeyRecoveryCode.findMany())
    ).not.toContain(result.recoveryCodes![0].replaceAll('-', ''))
  })
  it('requires an existing key, usable email, and unexpired proof before activation', async () => {
    await expect(
      required.setPasskeyRequired(session(1, 'passkey'), true)
    ).rejects.toThrow('Add and sign in')
    await addPasskey()
    await expect(
      required.setPasskeyRequired(
        session(1, 'passkey', Date.now() - 301000),
        true
      )
    ).rejects.toThrow('Sign in again')
    await prisma.user.update({
      where: { id: 'security-owner' },
      data: { email: null },
    })
    await expect(
      required.setPasskeyRequired(session(1, 'passkey'), true)
    ).rejects.toThrow('Add an email')
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: 'security-owner' } }))
        .passkeyRequired
    ).toBe(false)
    expect(await prisma.passkeyRecoveryCode.count()).toBe(0)
  })
  it('blocks password, authenticator, and old recovery logins while passkeys are required', async () => {
    const totp = await enroll()
    await requirePasskey(2)
    const authorize = authorizeProvider()
    expect(
      await authorize({ email: 'test@example.invalid', password: 'wrong' })
    ).toBeNull()
    for (const code of ['', totp.code, totp.recoveryCodes[0]]) {
      await expect(
        authorize({
          email: 'test@example.invalid',
          password: 'correct test password',
          code,
        })
      ).rejects.toThrow('PasskeyRequired')
    }
    expect(await prisma.recoveryCode.count()).toBe(10)
    expect(
      await authorizeProvider('passkey-recovery')({
        email: 'test@example.invalid',
        code: totp.recoveryCodes[0],
      })
    ).toBeNull()
  })
  it('blocks OIDC and weak JWT sessions even when a session version matches', async () => {
    const config = await (await import('@/lib/config')).getConfig()
    const issuer = config.settings.general.oidc.issuer.replace(/\/+$/, '')
    await prisma.user.update({
      where: { id: 'security-owner' },
      data: { oidcSubject: `${issuer}|subject` },
    })
    await requirePasskey()
    const signIn = auth.authOptions.callbacks!.signIn as unknown as (
      input: Record<string, unknown>
    ) => Promise<unknown>
    expect(
      await signIn({
        user: {},
        account: { provider: 'oidc' },
        profile: { sub: 'subject', email: 'test@example.invalid' },
      })
    ).toBe('/auth/login?local=1&error=OidcPasskeyRequired')
    const jwt = auth.authOptions.callbacks!.jwt as unknown as (
      input: Record<string, unknown>
    ) => Promise<Record<string, unknown>>
    for (const authMethod of ['credentials', 'oidc', 'recovery', undefined]) {
      await expect(
        jwt({
          token: { id: 'security-owner', sessionVersion: 2, authMethod },
          trigger: 'update',
          session: {
            user: { authMethod: 'passkey-recovery', authTime: Date.now() },
          },
        })
      ).rejects.toThrow('Passkey sign-in required')
    }
    expect(
      await jwt({
        token: {
          id: 'security-owner',
          sessionVersion: 2,
          authMethod: 'passkey',
        },
      })
    ).toMatchObject({ authMethod: 'passkey' })
  })
  it('supports password-free SSO-only emergency recovery and last-code repair', async () => {
    await prisma.user.update({
      where: { id: 'security-owner' },
      data: { password: null, oidcSubject: 'issuer|sso-only' },
    })
    const enabled = await requirePasskey()
    const code = enabled.recoveryCodes![0]
    await prisma.passkeyRecoveryCode.deleteMany({
      where: {
        userId: 'security-owner',
        hash: { not: crypto.passkeyRecoveryHash('security-owner', code) },
      },
    })
    const recovered = await authorizeProvider('passkey-recovery')({
      email: 'test@example.invalid',
      code: code.toUpperCase().replaceAll('-', ' '),
    })
    expect(recovered).toMatchObject({ id: 'security-owner', sessionVersion: 2 })
    expect(recovered).not.toHaveProperty('password')
    expect(await prisma.passkeyRecoveryCode.count()).toBe(0)
    const jwt = auth.authOptions.callbacks!.jwt as unknown as (
      input: Record<string, unknown>
    ) => Promise<Record<string, unknown>>
    const token = await jwt({
      token: {},
      user: recovered,
      account: { provider: 'passkey-recovery' },
    })
    expect(token.authMethod).toBe('passkey-recovery')
    const recoverySession = session(
      2,
      token.authMethod as string,
      token.authTime as number
    )
    expect(
      await passkeys.registrationOptions(recoverySession, {}, 'Replacement key')
    ).toHaveProperty('challengeId')
    expect(
      (await required.rotatePasskeyRecoveryCodes(recoverySession)).recoveryCodes
    ).toHaveLength(10)
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: 'security-owner' } }))
        .passkeyRequired
    ).toBe(true)
    expect(
      await required.authenticatePasskeyRecovery('test@example.invalid', code)
    ).toBeNull()
  })
  it('redeems a dedicated code atomically once and only for the owning account', async () => {
    const enabled = await requirePasskey()
    await prisma.user.create({
      data: {
        id: 'another-account',
        email: 'other@example.invalid',
        passkeyRequired: true,
        urlId: 'another-account',
        uploadToken: 'another-account',
      },
    })
    const code = enabled.recoveryCodes![0]
    expect(
      await required.authenticatePasskeyRecovery('other@example.invalid', code)
    ).toBeNull()
    const attempts = await Promise.all([
      required.authenticatePasskeyRecovery('test@example.invalid', code),
      required.authenticatePasskeyRecovery('test@example.invalid', code),
    ])
    expect(attempts.filter(Boolean)).toHaveLength(1)
    expect(await prisma.passkeyRecoveryCode.count()).toBe(9)
  })
  it('accepts matching and mixed-case email addresses for dedicated emergency recovery', async () => {
    await prisma.user.update({
      where: { id: 'security-owner' },
      data: { email: 'Test@Example.Invalid' },
    })
    const enabled = await requirePasskey()
    const authorize = authorizeProvider('passkey-recovery')
    for (const [index, email] of [
      'Test@Example.Invalid',
      'test@example.invalid',
      '  TEST@EXAMPLE.INVALID  ',
    ].entries()) {
      expect(
        await authorize({ email, code: enabled.recoveryCodes![index] })
      ).toMatchObject({ id: 'security-owner', email: 'Test@Example.Invalid' })
      expect(await prisma.passkeyRecoveryCode.count()).toBe(9 - index)
    }
  })
  it.each([
    ['_', 'X'],
    ['%', 'anything'],
    ['\\', ''],
  ])(
    'matches literal %s email characters without treating a different address as ambiguous',
    async (character, replacement) => {
      const email = `test${character}name@example.invalid`
      await prisma.user.update({
        where: { id: 'security-owner' },
        data: { email },
      })
      await prisma.user.create({
        data: {
          id: 'different-account',
          email: `test${replacement}name@example.invalid`,
          urlId: 'different-account',
          uploadToken: 'different-account',
        },
      })
      const enabled = await requirePasskey()
      expect(
        await authorizeProvider('passkey-recovery')({
          email: email.toUpperCase(),
          code: enabled.recoveryCodes![0],
        })
      ).toMatchObject({ id: 'security-owner', email })
      expect(await prisma.passkeyRecoveryCode.count()).toBe(9)
    }
  )
  it('does not allow wildcard email input to substitute for the owning address', async () => {
    const enabled = await requirePasskey()
    const code = enabled.recoveryCodes![0]
    const authorize = authorizeProvider('passkey-recovery')
    for (const email of [
      'te_t@example.invalid',
      '%@example.invalid',
      'test@%.invalid',
      'te\\st@example.invalid',
    ]) {
      expect(await authorize({ email, code })).toBeNull()
      expect(await prisma.passkeyRecoveryCode.count()).toBe(10)
    }
    expect(
      await authorize({ email: 'TEST@EXAMPLE.INVALID', code })
    ).toMatchObject({ id: 'security-owner' })
    expect(await prisma.passkeyRecoveryCode.count()).toBe(9)
  })
  it('rejects ambiguous case-variant emails without consuming even an exact-match account code', async () => {
    const enabled = await requirePasskey()
    await prisma.user.create({
      data: {
        id: 'case-variant-account',
        email: 'Test@Example.Invalid',
        // Optional accounts still make the address ambiguous.
        passkeyRequired: false,
        urlId: 'case-variant-account',
        uploadToken: 'case-variant-account',
      },
    })
    const code = enabled.recoveryCodes![0]
    const authorize = authorizeProvider('passkey-recovery')
    for (const email of [
      'test@example.invalid',
      'Test@Example.Invalid',
      'TEST@EXAMPLE.INVALID',
    ]) {
      expect(await authorize({ email, code })).toBeNull()
      expect(await prisma.passkeyRecoveryCode.count()).toBe(10)
    }
    await prisma.user.update({
      where: { id: 'case-variant-account' },
      data: { email: 'distinct@example.invalid' },
    })
    expect(
      await authorize({ email: 'TEST@EXAMPLE.INVALID', code })
    ).toMatchObject({ id: 'security-owner' })
    expect(await prisma.passkeyRecoveryCode.count()).toBe(9)
  })
  it('rechecks email ambiguity after locking without consuming a code if a collision appeared', async () => {
    const enabled = await requirePasskey()
    await prisma.user.create({
      data: {
        id: 'case-variant-account',
        email: 'distinct@example.invalid',
        urlId: 'case-variant-account',
        uploadToken: 'case-variant-account',
      },
    })
    const lookup = prisma.user.findMany.bind(prisma.user)
    const spy = vi
      .spyOn(prisma.user, 'findMany')
      .mockImplementationOnce((async (
        args: Parameters<typeof prisma.user.findMany>[0]
      ) => {
        const snapshot = await lookup(args)
        await prisma.user.update({
          where: { id: 'case-variant-account' },
          data: { email: 'Test@Example.Invalid' },
        })
        return snapshot
      }) as unknown as typeof prisma.user.findMany)
    try {
      expect(
        await required.authenticatePasskeyRecovery(
          'test@example.invalid',
          enabled.recoveryCodes![0]
        )
      ).toBeNull()
      expect(await prisma.passkeyRecoveryCode.count()).toBe(10)
    } finally {
      spy.mockRestore()
    }
  })
  it.each(['email', 'sessionVersion'] as const)(
    'preserves dedicated codes when %s changes after the recovery lookup',
    async (changedField) => {
      const enabled = await requirePasskey()
      const lookup = prisma.user.findMany.bind(prisma.user)
      const spy = vi
        .spyOn(prisma.user, 'findMany')
        .mockImplementationOnce((async (
          args: Parameters<typeof prisma.user.findMany>[0]
        ) => {
          const snapshot = await lookup(args)
          await prisma.user.update({
            where: { id: 'security-owner' },
            data:
              changedField === 'email'
                ? { email: 'changed@example.invalid' }
                : { sessionVersion: { increment: 1 } },
          })
          return snapshot
        }) as unknown as typeof prisma.user.findMany)
      try {
        expect(
          await required.authenticatePasskeyRecovery(
            'TEST@EXAMPLE.INVALID',
            enabled.recoveryCodes![0]
          )
        ).toBeNull()
        expect(await prisma.passkeyRecoveryCode.count()).toBe(10)
      } finally {
        spy.mockRestore()
      }
    }
  )
  it('requires current strong proof for all factor management while enforced', async () => {
    const totp = await enroll()
    await requirePasskey(2)
    for (const method of ['credentials', 'oidc', 'recovery']) {
      await expect(
        service.changeTotp(
          session(3, method),
          { password: 'correct test password', code: totp.recoveryCodes[0] },
          true
        )
      ).rejects.toThrow('Sign in again with a passkey')
    }
    await service.changeTotp(session(3, 'passkey-recovery'), {}, true)
    expect(await prisma.passkeyRecoveryCode.count()).toBe(10)
    expect(await prisma.recoveryCode.count()).toBe(0)
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: 'security-owner' } }))
        .passkeyRequired
    ).toBe(true)
  })
  it('preserves authenticator codes when mode is disabled and invalidates dedicated codes', async () => {
    const totp = await enroll()
    const enabled = await requirePasskey(2)
    await expect(
      required.setPasskeyRequired(session(3, 'credentials'), false)
    ).rejects.toThrow('Sign in again')
    await expect(
      required.setPasskeyRequired(
        session(3, 'passkey-recovery', Date.now() - 301000),
        false
      )
    ).rejects.toThrow('Sign in again')
    await required.setPasskeyRequired(session(3, 'passkey-recovery'), false)
    expect(await prisma.passkeyRecoveryCode.count()).toBe(0)
    expect(await prisma.recoveryCode.count()).toBe(10)
    expect(
      await required.authenticatePasskeyRecovery(
        'test@example.invalid',
        enabled.recoveryCodes![0]
      )
    ).toBeNull()
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: 'security-owner' } }))
        .totpSecret
    ).toBeTruthy()
    await redeem(totp.recoveryCodes[0])
    const reenabled = await required.setPasskeyRequired(
      session(4, 'passkey'),
      true
    )
    expect(reenabled.recoveryCodes).not.toContain(enabled.recoveryCodes![0])
  })
  it('prevents last-key deletion and concurrent deletions cannot remove every key', async () => {
    await requirePasskey()
    await expect(
      passkeys.changePasskey(session(2, 'passkey'), 'primary-passkey', {})
    ).rejects.toThrow('last passkey')
    await addPasskey('second-passkey')
    const results = await Promise.allSettled([
      passkeys.changePasskey(session(2, 'passkey'), 'primary-passkey', {}),
      passkeys.changePasskey(session(2, 'passkey'), 'second-passkey', {}),
    ])
    expect(
      results.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(1)
    expect(await prisma.passkey.count()).toBe(1)
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: 'security-owner' } }))
        .passkeyRequired
    ).toBe(true)
  })
  it('fences expired, stale and concurrent policy mutations', async () => {
    await addPasskey()
    const activations = await Promise.allSettled([
      required.setPasskeyRequired(session(1, 'passkey'), true),
      required.setPasskeyRequired(session(1, 'passkey'), true),
    ])
    expect(
      activations.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(1)
    await expect(
      required.rotatePasskeyRecoveryCodes(session(1, 'passkey'))
    ).rejects.toThrow('Account security changed')
    await expect(
      required.rotatePasskeyRecoveryCodes(
        session(2, 'passkey-recovery', Date.now() - 301000)
      )
    ).rejects.toThrow('Sign in again')
    await required.rotatePasskeyRecoveryCodes(session(2, 'passkey'))
    expect(await prisma.passkeyRecoveryCode.count()).toBe(10)
  })
  it('allows confirmed-email identity proof for enforced SSO-only accounts without weakening it', async () => {
    await prisma.user.update({
      where: { id: 'security-owner' },
      data: { password: null, oidcSubject: 'issuer|sso-only' },
    })
    await requirePasskey()
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: 'security-owner' },
    })
    const { assertRecentIdentity } = await import('@/lib/email/account')
    await expect(
      assertRecentIdentity(user, undefined, session(2, 'passkey'))
    ).resolves.toBeUndefined()
    await expect(
      assertRecentIdentity(user, undefined, session(2, 'passkey-recovery'))
    ).resolves.toBeUndefined()
    await expect(
      assertRecentIdentity(user, undefined, session(2, 'oidc'))
    ).rejects.toThrow('Sign in again with a passkey')
    await expect(
      assertRecentIdentity(
        user,
        undefined,
        session(2, 'passkey', Date.now() - 301000)
      )
    ).rejects.toThrow('Sign in again')
    await expect(
      assertRecentIdentity(user, undefined, session(1, 'passkey'))
    ).rejects.toThrow('Account security changed')
  })

  it('does not disable protection or remove the last key without a configured fallback', async () => {
    await prisma.user.update({
      where: { id: 'security-owner' },
      data: { password: null, oidcSubject: 'https://idp.example|sso-only' },
    })
    await requirePasskey()
    await expect(
      required.setPasskeyRequired(session(2, 'passkey-recovery'), false)
    ).rejects.toThrow('restore your configured SSO')
    expect(await prisma.passkeyRecoveryCode.count()).toBe(10)
    const { DEFAULT_CONFIG } = await import('@/lib/config')
    const config = structuredClone(DEFAULT_CONFIG)
    config.settings.general.oidc = {
      ...config.settings.general.oidc,
      enabled: true,
      issuer: 'https://other-idp.example',
      clientId: 'public-test-client',
      clientSecret: 'public-test-secret',
    }
    await prisma.config.create({
      data: { key: 'flare_config', value: JSON.parse(JSON.stringify(config)) },
    })
    await expect(
      required.setPasskeyRequired(session(2, 'passkey-recovery'), false)
    ).rejects.toThrow('restore your configured SSO')
    config.settings.general.oidc.issuer = 'https://idp.example'
    await prisma.config.update({
      where: { key: 'flare_config' },
      data: { value: JSON.parse(JSON.stringify(config)) },
    })
    await required.setPasskeyRequired(session(2, 'passkey-recovery'), false)
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: 'security-owner' } }))
        .passkeyRequired
    ).toBe(false)
    await prisma.user.update({
      where: { id: 'security-owner' },
      data: { totpSecret: 'legacy-local-totp' },
    })
    await expect(
      passkeys.changePasskey(session(3, 'passkey'), 'primary-passkey', {})
    ).rejects.toThrow('Keep a passkey')
    await prisma.user.update({
      where: { id: 'security-owner' },
      data: { totpSecret: null },
    })
    config.settings.general.oidc.enabled = false
    await prisma.config.update({
      where: { key: 'flare_config' },
      data: { value: JSON.parse(JSON.stringify(config)) },
    })
    await expect(
      passkeys.changePasskey(session(3, 'passkey'), 'primary-passkey', {})
    ).rejects.toThrow('Keep a passkey')
    expect(await prisma.passkey.count()).toBe(1)
  })

  it('pins in-place passkey confirmation to the account originally being managed', async () => {
    await addPasskey()
    const options = await passkeys.authenticationOptions()
    await expect(
      passkeys.authenticatePasskey(
        options.challengeId,
        { id: 'primary-passkey', response: {} } as never,
        options.binding,
        'different-account'
      )
    ).rejects.toThrow('Choose a passkey for the account')
    expect(
      (
        await prisma.passkey.findUniqueOrThrow({
          where: { id: 'primary-passkey' },
        })
      ).lastUsedAt
    ).toBeNull()
  })
  it('applies durable account limits to dedicated emergency recovery attempts', async () => {
    const authorize = authorizeProvider('passkey-recovery')
    for (let attempt = 0; attempt < 30; attempt += 1) {
      expect(
        await authorize({
          email: 'test@example.invalid',
          code: 'incorrect-code',
        })
      ).toBeNull()
    }
    await expect(
      authorize({ email: 'test@example.invalid', code: 'incorrect-code' })
    ).rejects.toThrow('TooManyAttempts')
  })

  it('requires a second factor in the actual NextAuth credentials authorizer and never returns secrets', async () => {
    const provider = auth.authOptions.providers[0] as unknown as {
      options: {
        authorize: (
          credentials: Record<string, string>,
          req: { headers: Record<string, string> }
        ) => Promise<unknown>
      }
    }
    const credentials = {
      email: 'test@example.invalid',
      password: 'correct test password',
    }
    expect(
      await provider.options.authorize(
        { ...credentials, password: 'wrong' },
        { headers: {} }
      )
    ).toBeNull()
    const result = await provider.options.authorize(credentials, {
      headers: {},
    })
    expect(result).toMatchObject({ id: 'security-owner', sessionVersion: 1 })
    expect(result).not.toHaveProperty('password')
    expect(result).not.toHaveProperty('totpSecret')
    const enrolled = await enroll()
    await expect(
      provider.options.authorize(credentials, { headers: {} })
    ).rejects.toThrow('TwoFactorRequired')
    expect(
      await provider.options.authorize(
        { ...credentials, code: '000000' },
        { headers: {} }
      )
    ).toBeNull()
    expect(
      await provider.options.authorize(
        { ...credentials, code: enrolled.recoveryCodes[0] },
        { headers: {} }
      )
    ).toMatchObject({ id: 'security-owner', sessionVersion: 2 })
    expect(
      await provider.options.authorize(
        { ...credentials, code: enrolled.recoveryCodes[0] },
        { headers: {} }
      )
    ).toBeNull()
  })

  it('rejects a password login whose email or security version changes during verification', async () => {
    const provider = auth.authOptions.providers[0] as unknown as {
      options: {
        authorize: (
          credentials: Record<string, string>,
          req: { headers: Record<string, string> }
        ) => Promise<unknown>
      }
    }
    const lookup = prisma.user.findUnique.bind(prisma.user)
    const spy = vi
      .spyOn(prisma.user, 'findUnique')
      .mockImplementationOnce((async (
        args: Parameters<typeof prisma.user.findUnique>[0]
      ) => {
        const snapshot = await lookup(args)
        await prisma.user.update({
          where: { id: 'security-owner' },
          data: {
            email: 'changed@example.invalid',
            sessionVersion: { increment: 1 },
          },
        })
        return snapshot
      }) as unknown as typeof prisma.user.findUnique)
    try {
      expect(
        await provider.options.authorize(
          { email: 'test@example.invalid', password: 'correct test password' },
          { headers: {} }
        )
      ).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })

  it('rejects stale JWT versions and ignores client attempts to refresh authentication proof', async () => {
    const jwt = auth.authOptions.callbacks!.jwt as unknown as (
      input: Record<string, unknown>
    ) => Promise<Record<string, unknown>>
    await expect(
      jwt({
        token: { id: 'security-owner', sessionVersion: 0 },
        trigger: 'update',
      })
    ).rejects.toThrow('Version mismatch')
    const authTime = Date.now() - 600000
    const token = await jwt({
      token: {
        id: 'security-owner',
        sessionVersion: 1,
        authTime,
        authMethod: 'credentials',
      },
      trigger: 'update',
      session: {
        user: {
          authTime: Date.now(),
          authMethod: 'passkey',
          sessionVersion: 1,
        },
      },
    })
    expect(token.authTime).toBe(authTime)
    expect(token.authMethod).toBe('credentials')
  })

  it('lets a last recovery-code login restore protection without a second code', async () => {
    const enrolled = await enroll()
    const lastCode = enrolled.recoveryCodes[0]
    await prisma.recoveryCode.deleteMany({
      where: {
        userId: 'security-owner',
        hash: { not: crypto.recoveryHash('security-owner', lastCode) },
      },
    })
    const provider = auth.authOptions.providers[0] as unknown as {
      options: {
        authorize: (
          credentials: Record<string, string>,
          req: { headers: Record<string, string> }
        ) => Promise<unknown>
      }
    }
    const user = await provider.options.authorize(
      {
        email: 'test@example.invalid',
        password: 'correct test password',
        code: lastCode,
      },
      { headers: {} }
    )
    expect(user).toMatchObject({ authenticationMethod: 'recovery' })
    expect(await prisma.recoveryCode.count()).toBe(0)
    const jwt = auth.authOptions.callbacks!.jwt as unknown as (
      input: Record<string, unknown>
    ) => Promise<Record<string, unknown>>
    const token = await jwt({
      token: {},
      user,
      account: { provider: 'credentials' },
    })
    expect(token.authMethod).toBe('recovery')
    const recovered = session(
      token.sessionVersion as number,
      token.authMethod as string,
      token.authTime as number
    )
    expect(
      await passkeys.registrationOptions(recovered, {}, 'Replacement passkey')
    ).toHaveProperty('challengeId')
    await expect(
      service.changeTotp(session(2, 'recovery', Date.now() - 301000), {}, false)
    ).rejects.toThrow('current password')
    const replacement = await service.changeTotp(recovered, {}, false)
    expect(replacement.recoveryCodes).toHaveLength(10)
    expect(await prisma.recoveryCode.count()).toBe(10)
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: 'security-owner' } }))
        .sessionVersion
    ).toBe(3)
  })

  it('does not trust recovery proof from OAuth profiles or client session updates', async () => {
    const jwt = auth.authOptions.callbacks!.jwt as unknown as (
      input: Record<string, unknown>
    ) => Promise<Record<string, unknown>>
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: 'security-owner' },
    })
    const oidc = await jwt({
      token: {},
      user: { ...user, authenticationMethod: 'recovery' },
      account: { provider: 'oidc' },
    })
    expect(oidc.authMethod).toBe('oidc')
    const authTime = Date.now() - 600000
    const updated = await jwt({
      token: {
        id: user.id,
        sessionVersion: 1,
        authTime,
        authMethod: 'credentials',
      },
      trigger: 'update',
      session: {
        user: {
          authTime: Date.now(),
          authMethod: 'recovery',
          authenticationMethod: 'recovery',
        },
      },
    })
    expect(updated.authMethod).toBe('credentials')
    expect(updated.authTime).toBe(authTime)
  })

  it('requires fresh identity, encrypts pending setup, enables only with valid code, and revokes sessions', async () => {
    await expect(
      service.setupTotp(session(), { password: 'wrong' })
    ).rejects.toThrow('current password')
    const setup = await service.setupTotp(session(), {
      password: 'correct test password',
    })
    const pending = await prisma.authChallenge.findFirstOrThrow()
    expect(JSON.stringify(pending.payload)).not.toContain(setup.secret)
    await expect(
      service.enableTotp(session(), 'invalid', setup.challengeId)
    ).rejects.toThrow('Invalid authentication')
    const result = await service.enableTotp(
      session(),
      crypto.createTotp(setup.secret).generate(),
      setup.challengeId
    )
    expect(result.recoveryCodes).toHaveLength(10)
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: 'security-owner' },
    })
    expect(user.sessionVersion).toBe(2)
    expect(user.totpSecret).not.toContain(setup.secret)
    expect(await prisma.authChallenge.count()).toBe(0)
    expect(await prisma.recoveryCode.count()).toBe(10)
  })
  it('requires the challenge handle returned by the fresh-proof setup request', async () => {
    const setup = await service.setupTotp(session(), {
      password: 'correct test password',
    })
    const code = crypto.createTotp(setup.secret).generate()
    await expect(
      service.enableTotp(session(), code, 'different-challenge-handle')
    ).rejects.toThrow('expired')
    await expect(service.enableTotp(session(), code, '')).rejects.toThrow(
      'expired'
    )
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: 'security-owner' } }))
        .totpSecret
    ).toBeNull()
    expect(await prisma.recoveryCode.count()).toBe(0)
    expect(
      await service.enableTotp(session(), code, setup.challengeId)
    ).toHaveProperty('recoveryCodes')
  })
  it('rejects replayed TOTP including the enrollment code', async () => {
    const enrolled = await enroll()
    await expect(redeem(enrolled.code)).rejects.toThrow('already used')
    const next = crypto
      .createTotp(enrolled.secret)
      .generate({ timestamp: Date.now() + 30000 })
    await redeem(next)
    await expect(redeem(next)).rejects.toThrow('already used')
  })
  it('atomically consumes each recovery code once under concurrent attempts', async () => {
    const enrolled = await enroll()
    const results = await Promise.allSettled([
      redeem(enrolled.recoveryCodes[0]),
      redeem(enrolled.recoveryCodes[0]),
    ])
    expect(
      results.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(1)
    expect(await prisma.recoveryCode.count()).toBe(9)
  })
  it('allows a saved recovery code even if the authenticator encryption key changed', async () => {
    const enrolled = await enroll()
    const original = process.env.NEXTAUTH_SECRET!
    vi.stubEnv('NEXTAUTH_SECRET', 'a-different-disposable-secret-value')
    await redeem(enrolled.recoveryCodes[0])
    vi.stubEnv('NEXTAUTH_SECRET', original)
  })
  it('requires the current second factor before rotating recovery codes', async () => {
    const enrolled = await enroll()
    await expect(
      service.changeTotp(
        session(2),
        { password: 'correct test password' },
        false
      )
    ).rejects.toThrow('authentication code')
    const result = await service.changeTotp(
      session(2),
      { password: 'correct test password', code: enrolled.recoveryCodes[0] },
      false
    )
    expect(result.recoveryCodes).toHaveLength(10)
    await expect(redeem(enrolled.recoveryCodes[1])).rejects.toThrow(
      'authentication code'
    )
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: 'security-owner' } }))
        .sessionVersion
    ).toBe(3)
  })
  it('fences pending enrollment and stale sessions after a password/session change', async () => {
    const setup = await service.setupTotp(session(), {
      password: 'correct test password',
    })
    await prisma.user.update({
      where: { id: 'security-owner' },
      data: { sessionVersion: { increment: 1 } },
    })
    await expect(
      service.enableTotp(
        session(),
        crypto.createTotp(setup.secret).generate(),
        setup.challengeId
      )
    ).rejects.toThrow('Sign in again')
    await expect(
      service.enableTotp(
        session(2),
        crypto.createTotp(setup.secret).generate(),
        setup.challengeId
      )
    ).rejects.toThrow('expired')
  })
  it('expires pending setup and replaces older setup attempts', async () => {
    await service.setupTotp(session(), { password: 'correct test password' })
    const setup = await service.setupTotp(session(), {
      password: 'correct test password',
    })
    expect(await prisma.authChallenge.count()).toBe(1)
    await prisma.authChallenge.updateMany({ data: { expiresAt: new Date(0) } })
    await expect(
      service.enableTotp(
        session(),
        crypto.createTotp(setup.secret).generate(),
        setup.challengeId
      )
    ).rejects.toThrow('expired')
  })
  it('requires local password for TOTP and recent SSO for SSO-only passkey enrollment', async () => {
    await prisma.user.update({
      where: { id: 'security-owner' },
      data: { password: null, oidcSubject: 'issuer|test' },
    })
    await expect(service.setupTotp(session(1, 'oidc'), {})).rejects.toThrow(
      'existing local password'
    )
    await expect(
      passkeys.registrationOptions(
        session(1, 'oidc', Date.now() - 301000),
        {},
        'Laptop'
      )
    ).rejects.toThrow('Sign in again')
    const options = await passkeys.registrationOptions(
      session(1, 'oidc'),
      {},
      'Laptop'
    )
    expect(options.options.authenticatorSelection).toMatchObject({
      residentKey: 'required',
      userVerification: 'required',
    })
  })
  it('binds passwordless challenges to the initiating browser and consumes successful claims once', async () => {
    const options = await passkeys.authenticationOptions()
    expect(options.options.userVerification).toBe('required')
    await expect(
      passkeys.authenticatePasskey(
        options.challengeId,
        { id: 'missing' } as never,
        'other-browser'
      )
    ).rejects.toThrow('another browser')
    const claims = await Promise.allSettled([
      prisma.$transaction((tx) =>
        service.consumeChallenge(tx, options.challengeId, 'passkey_login')
      ),
      prisma.$transaction((tx) =>
        service.consumeChallenge(tx, options.challengeId, 'passkey_login')
      ),
    ])
    expect(
      claims.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(1)
  })
  it('allows a recent passkey to disable TOTP, but rejects stale proof', async () => {
    await enroll()
    await expect(
      service.changeTotp(session(2, 'passkey', Date.now() - 301000), {}, true)
    ).rejects.toThrow('current password')
    await service.changeTotp(session(2, 'passkey'), {}, true)
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: 'security-owner' } }))
        .totpSecret
    ).toBeNull()
    expect(await prisma.recoveryCode.count()).toBe(0)
  })
  it('cleans expired attempt buckets while retaining active limits', async () => {
    await prisma.authRateLimit.createMany({
      data: [
        {
          key: 'old-attempt',
          count: 100,
          resetAt: new Date(Date.now() - 25 * 3600000),
        },
        {
          key: 'active-attempt',
          count: 100,
          resetAt: new Date(Date.now() + 900000),
        },
      ],
    })
    const worker = await import('@/lib/auth/security/worker')
    await worker.cleanupExpiredAuthLimits()
    expect(
      await prisma.authRateLimit.findUnique({ where: { key: 'old-attempt' } })
    ).toBeNull()
    expect(
      await prisma.authRateLimit.findUnique({
        where: { key: 'active-attempt' },
      })
    ).toMatchObject({ count: 100 })
  })
  it('bounds expired-bucket cleanup and keeps it out of authentication attempts', async () => {
    await prisma.authRateLimit.createMany({
      data: Array.from({ length: 1005 }, (_, i) => ({
        key: `expired-${i}`,
        count: 1,
        resetAt: new Date(Date.now() - 25 * 3600000),
      })),
    })
    await shared.securityLimit('request-no-cleanup')
    expect(await prisma.authRateLimit.count()).toBe(1006)
    const worker = await import('@/lib/auth/security/worker')
    expect(await worker.cleanupExpiredAuthLimits()).toBe(1000)
    expect(await prisma.authRateLimit.count()).toBe(6)
    expect(await worker.cleanupExpiredAuthLimits()).toBe(5)
    expect(await prisma.authRateLimit.count()).toBe(1)
  })
  it('enforces shared durable attempt limits across concurrent requests', async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, () => shared.securityLimit('concurrent', 3))
    )
    expect(
      attempts.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(3)
    expect((await prisma.authRateLimit.findFirstOrThrow()).count).toBe(6)
  })
})
