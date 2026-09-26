import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  transaction: vi.fn(),
  createUser: vi.fn(),
}))

vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique, update: mocks.userUpdate },
    $transaction: mocks.transaction,
  },
}))

vi.mock('@/lib/users/create-user', () => ({
  createUser: mocks.createUser,
}))

const { resolveOidcUser } = await import('@/lib/auth/oidc-resolve-user')
type OidcConfig = Parameters<typeof resolveOidcUser>[1]
type OidcProfile = Parameters<typeof resolveOidcUser>[0]

function makeConfig(overrides: Partial<OidcConfig> = {}): OidcConfig {
  return {
    autoProvision: true,
    requireEmailVerified: true,
    ...overrides,
  }
}

function makeProfile(overrides: Partial<OidcProfile> = {}): OidcProfile {
  return {
    sub: 'idp-subject-1',
    email: 'user@example.com',
    email_verified: true,
    name: 'Example User',
    ...overrides,
  }
}

const dbUser = {
  id: 'existing-user-id',
  email: 'user@example.com',
  name: 'Existing User',
  image: null,
  sessionVersion: 1,
  password: null,
  emailVerified: new Date('2026-01-01T00:00:00Z'),
  oidcSubject: 'idp-subject-1',
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
    cb({ $executeRaw: vi.fn() })
  )
})

describe('resolveOidcUser', () => {
  it('resolves an existing user by oidcSubject without any email checks', async () => {
    mocks.userFindUnique.mockResolvedValueOnce(dbUser)

    const result = await resolveOidcUser(
      makeProfile({ email: undefined, email_verified: false }),
      makeConfig({ requireEmailVerified: true })
    )

    expect(result).toEqual({
      ok: true,
      user: expect.objectContaining({ id: dbUser.id }),
    })
    expect(mocks.userFindUnique).toHaveBeenCalledTimes(1)
    expect(mocks.userFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { oidcSubject: 'idp-subject-1' } })
    )
    expect(mocks.userUpdate).not.toHaveBeenCalled()
    expect(mocks.createUser).not.toHaveBeenCalled()
  })

  it('rejects with no_email when the provider omits an email', async () => {
    mocks.userFindUnique.mockResolvedValueOnce(null) // oidcSubject lookup misses

    const result = await resolveOidcUser(
      makeProfile({ email: null }),
      makeConfig()
    )

    expect(result).toEqual({ ok: false, reason: 'no_email' })
  })

  it.each([false, null, undefined])(
    'rejects unverified email before any email-based lookup (email_verified=%s)',
    async (emailVerified) => {
      mocks.userFindUnique.mockResolvedValueOnce(null) // oidcSubject lookup misses

      const result = await resolveOidcUser(
        makeProfile({ email_verified: emailVerified }),
        makeConfig({
          requireEmailVerified: true,
          autoProvision: true,
        })
      )

      expect(result).toEqual({ ok: false, reason: 'email_unverified' })
      expect(mocks.userFindUnique).toHaveBeenCalledTimes(1) // only the subject lookup
      expect(mocks.userUpdate).not.toHaveBeenCalled()
      expect(mocks.createUser).not.toHaveBeenCalled()
    }
  )

  it.each([
    {
      account: 'an unverified local account with a preclaimed email',
      user: {
        ...dbUser,
        password: 'attacker-controlled-password-hash',
        emailVerified: null,
        oidcSubject: null,
      },
    },
    {
      account: 'a verified local account',
      user: {
        ...dbUser,
        password: 'existing-password-hash',
        oidcSubject: null,
      },
    },
    {
      account: 'an account linked to a different SSO subject',
      user: { ...dbUser, oidcSubject: 'previous-idp-subject' },
    },
  ])(
    'rejects an email match for $account without modifying it',
    async ({ user }) => {
      const originalUser = { ...user }
      mocks.userFindUnique
        .mockResolvedValueOnce(null) // oidcSubject lookup misses
        .mockResolvedValueOnce(user) // email lookup hits

      const result = await resolveOidcUser(makeProfile(), makeConfig())

      expect(result).toEqual({ ok: false, reason: 'account_exists' })
      expect(mocks.userFindUnique).toHaveBeenCalledTimes(2)
      expect(mocks.userFindUnique).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: { email: 'user@example.com' } })
      )
      expect(mocks.userUpdate).not.toHaveBeenCalled()
      expect(mocks.createUser).not.toHaveBeenCalled()
      expect(mocks.transaction).not.toHaveBeenCalled()
      expect(user).toEqual(originalUser)
    }
  )

  it('rejects an email match even when email verification is disabled', async () => {
    mocks.userFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(dbUser)

    const result = await resolveOidcUser(
      makeProfile({ email_verified: undefined }),
      makeConfig({ requireEmailVerified: false })
    )

    expect(result).toEqual({ ok: false, reason: 'account_exists' })
    expect(mocks.userUpdate).not.toHaveBeenCalled()
    expect(mocks.createUser).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('auto-provisions a new user when no match exists, falling back to the email prefix for name', async () => {
    const createdUser = { ...dbUser, id: 'new-user-id' }
    mocks.userFindUnique
      .mockResolvedValueOnce(null) // oidcSubject lookup misses
      .mockResolvedValueOnce(null) // email lookup misses
    mocks.createUser.mockResolvedValueOnce(createdUser)

    const result = await resolveOidcUser(
      makeProfile({ name: undefined, email: 'newperson@example.com' }),
      makeConfig({ autoProvision: true })
    )

    expect(result).toEqual({
      ok: true,
      user: expect.objectContaining({ id: createdUser.id }),
    })
    expect(mocks.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ $executeRaw: expect.any(Function) }),
      expect.objectContaining({
        email: 'newperson@example.com',
        name: 'newperson',
        oidcSubject: 'idp-subject-1',
      })
    )
  })

  it.each([
    { verified: true, expectDate: true },
    { verified: false, expectDate: false },
  ])(
    'stamps emailVerified on auto-provisioned users iff the IdP verified it (verified=$verified)',
    async ({ verified, expectDate }) => {
      mocks.userFindUnique
        .mockResolvedValueOnce(null) // oidcSubject lookup misses
        .mockResolvedValueOnce(null) // email lookup misses
      mocks.createUser.mockResolvedValueOnce({ ...dbUser, id: 'stamped' })

      await resolveOidcUser(
        makeProfile({ email_verified: verified }),
        makeConfig({ autoProvision: true, requireEmailVerified: false })
      )

      const [, createUserInput] = mocks.createUser.mock.calls[0]
      if (expectDate) {
        expect(createUserInput.emailVerified).toBeInstanceOf(Date)
      } else {
        expect(createUserInput.emailVerified).toBeUndefined()
      }
    }
  )

  it('rejects with not_provisioned when no match exists and autoProvision is disabled', async () => {
    mocks.userFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

    const result = await resolveOidcUser(
      makeProfile(),
      makeConfig({ autoProvision: false })
    )

    expect(result).toEqual({ ok: false, reason: 'not_provisioned' })
    expect(mocks.createUser).not.toHaveBeenCalled()
  })
})
