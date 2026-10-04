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

const databaseUrl = process.env.FLARE_SECURITY_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

suite('account security against disposable PostgreSQL', () => {
  let prisma: typeof import('@/lib/database/prisma').prisma
  let service: typeof import('@/lib/auth/security/service')
  let crypto: typeof import('@/lib/auth/security/crypto')
  let shared: typeof import('@/lib/auth/security/shared')
  let passkeys: typeof import('@/lib/auth/security/passkeys')
  let auth: typeof import('@/lib/auth')
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
    const url = new URL(databaseUrl!)
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      (!/^flare_security_test_/.test(url.searchParams.get('schema') ?? '') &&
        !/^\/flare_security_test_/.test(url.pathname))
    )
      throw new Error(
        'Use a disposable local flare_security_test_ database or schema'
      )
    vi.stubEnv('DATABASE_URL', url.toString())
    vi.stubEnv('NEXTAUTH_SECRET', 'disposable-security-test-key-32-characters')
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000')
    prisma = (await import('@/lib/database/prisma')).prisma
    service = await import('@/lib/auth/security/service')
    crypto = await import('@/lib/auth/security/crypto')
    shared = await import('@/lib/auth/security/shared')
    passkeys = await import('@/lib/auth/security/passkeys')
    auth = await import('@/lib/auth')
    password = await hash('correct test password', 4)
  })
  beforeEach(async () => {
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
    await shared.securityLimit('cleanup-trigger')
    expect(
      await prisma.authRateLimit.findUnique({ where: { key: 'old-attempt' } })
    ).toBeNull()
    expect(
      await prisma.authRateLimit.findUnique({
        where: { key: 'active-attempt' },
      })
    ).toMatchObject({ count: 100 })
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
