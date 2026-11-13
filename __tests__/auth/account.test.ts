import type { NextAuthOptions, Session } from 'next-auth'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { auditContext } from '@/lib/audit/context'
import { authOptions } from '@/lib/auth'
import { accountSelect, loadAccount, sessionAccount } from '@/lib/auth/account'
import { getAuthenticatedUser } from '@/lib/auth/api-auth'
import { DEFAULT_EMAIL_CONFIG } from '@/lib/email/schema'
import { requireAccount } from '@/lib/http/access'
import { hashApiToken } from '@/lib/integrations/tokens'
import { withRequestScope } from '@/lib/runtime/request-scope'

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  role: { findUnique: vi.fn() },
  apiToken: { findUnique: vi.fn(), update: vi.fn() },
  browserSession: { findFirst: vi.fn(), updateMany: vi.fn() },
}))
const mocks = vi.hoisted(() => ({
  emailConfig: vi.fn(),
  /** The session token a browser's cookie holds, or null when signed out. */
  cookie: null as Record<string, unknown> | null,
}))
vi.mock('@/lib/database/prisma', () => ({ prisma: db }))
vi.mock('@/lib/email/config', () => ({ getEmailConfig: mocks.emailConfig }))
// What next-auth does with a session cookie: the `jwt` callback checks its
// token, then the `session` callback describes the session. Both are Flare's.
vi.mock('next-auth', () => ({
  getServerSession: async (options: NextAuthOptions) => {
    if (!mocks.cookie) return null
    const token = await options.callbacks!.jwt!({
      token: { ...mocks.cookie },
    } as never)
    return options.callbacks!.session!({
      session: { user: {}, expires: '' },
      token,
    } as never)
  },
}))

const role = (
  id: string,
  position: number,
  permissions: string[],
  systemKey: string | null = null
) => ({
  id,
  name: id,
  description: '',
  color: '#64748b',
  position,
  systemKey,
  permissions,
})
const editor = role('editor', 10, ['files.share'])
let everyone: ReturnType<typeof role> | null
/** The account's row, as `accountSelect` reads it. */
let stored: ReturnType<typeof row>
const row = () => ({
  id: 'account-1',
  name: 'Alex',
  email: 'alex@example.test',
  image: null,
  sessionVersion: 3,
  passkeyRequired: false,
  emailVerified: null as Date | null,
  emailVerifiedFor: null as string | null,
  emailVerificationSource: null as string | null,
  emailExempt: false,
  createdAt: new Date('2025-01-01T00:00:00.000Z'),
  storageUsed: 12,
  urlId: 'alex1',
  vanityId: 'alex' as string | null,
  randomizeFileUrls: true,
  roles: [editor],
})
const legacyToken = 'legacy-upload-token'
const namedSecret = 'flr_fixture-named-token'
let namedToken: {
  id: string
  scopes: string[]
  profileId: string | null
  revokedAt: Date | null
  expiresAt: Date | null
}
/** Every account must verify its address, and no grace period is left. */
const verificationRequired = () => ({
  ...structuredClone(DEFAULT_EMAIL_CONFIG),
  enabled: true,
  verification: {
    ...structuredClone(DEFAULT_EMAIL_CONFIG.verification),
    mode: 'all_users' as const,
    requiredSince: null,
    graceEndsAt: null,
  },
})

/** The fields of the account a route is given, and no others. */
const authenticatedFields = [
  'credential',
  'id',
  'permissions',
  'randomizeFileUrls',
  'roles',
  'storageUsed',
  'urlId',
  'vanityId',
]
const request = (authorization?: string, path = '/api/files', method = 'GET') =>
  new Request(`https://flare.test${path}`, {
    method,
    headers: authorization ? { authorization } : {},
  })
const bearer = (token: string) => `Bearer ${token}`
/** Runs `work` as an audited request and answers the actor it left behind. */
async function actorOf(work: () => Promise<unknown>) {
  const context: { actorId?: string | null; tokenId?: string } = {}
  await auditContext.run(context, work)
  return context
}

beforeEach(() => {
  vi.clearAllMocks()
  stored = row()
  everyone = role('everyone', 0, ['files.read', 'files.upload'], 'everyone')
  namedToken = {
    id: 'token-1',
    scopes: ['files:read'],
    profileId: 'profile-1',
    revokedAt: null,
    expiresAt: null,
  }
  mocks.cookie = {
    id: stored.id,
    sessionVersion: stored.sessionVersion,
    sessionId: 'browser-1',
    authMethod: 'credentials',
    name: 'A stale name',
  }
  mocks.emailConfig.mockImplementation(async () =>
    structuredClone(DEFAULT_EMAIL_CONFIG)
  )
  // Like the database, a lookup finds a row only by its own key.
  db.user.findUnique.mockImplementation(
    async ({ where }: { where: { id?: string; uploadToken?: string } }) =>
      where.id === stored.id || where.uploadToken === legacyToken
        ? structuredClone(stored)
        : null
  )
  db.role.findUnique.mockImplementation(async () => everyone)
  db.apiToken.findUnique.mockImplementation(
    async ({ where }: { where: { hash: string } }) =>
      where.hash === hashApiToken(namedSecret)
        ? { ...namedToken, user: structuredClone(stored) }
        : null
  )
  db.apiToken.update.mockResolvedValue({})
  db.browserSession.findFirst.mockImplementation(async () => ({
    id: 'browser-1',
    userId: stored.id,
    sessionVersion: stored.sessionVersion,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    lastSeenAt: new Date(),
  }))
  db.browserSession.updateMany.mockResolvedValue({ count: 1 })
})

describe('an account with its roles and email standing', () => {
  it('answers the account’s fields, its access and whether it must verify its email', async () => {
    const account = await loadAccount({ id: stored.id })
    const { roles: _roles, ...fields } = row()
    expect(account).toEqual({
      ...fields,
      // The account's own roles and the role everyone holds, highest first.
      access: {
        roles: [editor, everyone],
        permissions: expect.any(Array),
      },
      emailAccessRequired: false,
    })
    expect([...account!.access.permissions].sort()).toEqual([
      'files.read',
      'files.share',
      'files.upload',
    ])
    expect(account).not.toHaveProperty('roles')
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { id: stored.id },
      select: accountSelect,
    })
    expect(db.role.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { systemKey: 'everyone' } })
    )
  })

  it('never reads the password or other credentials', () => {
    expect(Object.keys(accountSelect).sort()).toEqual(
      [...Object.keys(row())].sort()
    )
    for (const secret of ['password', 'uploadToken', 'totpSecret'])
      expect(accountSelect).not.toHaveProperty(secret)
  })

  it('starts the account, the everyone role and the email policy together', async () => {
    let answer!: (user: unknown) => void
    db.user.findUnique.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      })
    )
    const loading = loadAccount({ id: stored.id })
    // Neither of the other reads waits for the account's row.
    expect(db.user.findUnique).toHaveBeenCalledOnce()
    expect(db.role.findUnique).toHaveBeenCalledOnce()
    expect(mocks.emailConfig).toHaveBeenCalledOnce()
    answer(stored)
    expect((await loading)?.id).toBe(stored.id)
  })

  it('answers null for an account that does not exist', async () => {
    expect(await loadAccount({ id: 'nobody' })).toBeNull()
    expect(await loadAccount({ uploadToken: 'unknown' })).toBeNull()
  })

  it('gives an account without roles what everyone holds, and nothing without that role', async () => {
    stored.roles = []
    expect((await loadAccount({ id: stored.id }))?.access).toEqual({
      roles: [everyone],
      permissions: ['files.read', 'files.upload'],
    })
    everyone = null
    expect((await loadAccount({ id: stored.id }))?.access).toEqual({
      roles: [],
      permissions: [],
    })
  })

  it('marks an account that must verify its email, and not one that has or is exempt', async () => {
    mocks.emailConfig.mockImplementation(async () => verificationRequired())
    expect(await loadAccount({ id: stored.id })).toMatchObject({
      emailAccessRequired: true,
    })
    stored.emailExempt = true
    expect(await loadAccount({ id: stored.id })).toMatchObject({
      emailAccessRequired: false,
    })
    stored.emailExempt = false
    stored.emailVerified = new Date('2026-01-01T00:00:00.000Z')
    stored.emailVerifiedFor = stored.email
    stored.emailVerificationSource = 'email'
    expect(await loadAccount({ id: stored.id })).toMatchObject({
      emailAccessRequired: false,
    })
  })
})

describe('the account read once for a request', () => {
  it('reads the account once for the session token, the session and the route’s own check', async () => {
    const user = await withRequestScope(() => requireAccount(request()))
    expect(user.id).toBe(stored.id)
    expect(db.user.findUnique).toHaveBeenCalledOnce()
    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { id: stored.id },
      select: accountSelect,
    })
    expect(db.role.findUnique).toHaveBeenCalledOnce()
    expect(mocks.emailConfig).toHaveBeenCalledOnce()
    // The browser session is read once too, beside the account.
    expect(db.browserSession.findFirst).toHaveBeenCalledOnce()
    expect(db.apiToken.findUnique).not.toHaveBeenCalled()
  })

  it('reads it for each of the three outside a request', async () => {
    const user = await requireAccount(request())
    expect(user.id).toBe(stored.id)
    expect(db.user.findUnique).toHaveBeenCalledTimes(3)
    expect(db.role.findUnique).toHaveBeenCalledTimes(3)
  })

  it('reads it again for the next request, which sees a role taken away meanwhile', async () => {
    const read = () => withRequestScope(() => requireAccount(request()))
    await expect(read()).resolves.toMatchObject({ id: stored.id })
    everyone = role('everyone', 0, ['files.upload'], 'everyone')
    await expect(read()).rejects.toMatchObject({
      status: 403,
      message: 'You do not have permission to perform this action.',
    })
    expect(db.user.findUnique).toHaveBeenCalledTimes(2)
    expect(db.role.findUnique).toHaveBeenCalledTimes(2)
  })

  it('keeps the accounts of two requests in progress apart', async () => {
    const [first, second] = await Promise.all([
      withRequestScope(() => sessionAccount(stored.id)),
      withRequestScope(() => sessionAccount(stored.id)),
    ])
    expect(first).toEqual(second)
    expect(first).not.toBe(second)
    expect(db.user.findUnique).toHaveBeenCalledTimes(2)
  })

  it('reads each account a request asks for once', async () => {
    await withRequestScope(async () => {
      const [account, again, nobody] = await Promise.all([
        sessionAccount(stored.id),
        sessionAccount(stored.id),
        sessionAccount('nobody'),
      ])
      expect(again).toBe(account)
      expect(nobody).toBeNull()
      // An account that does not exist is not looked up twice either.
      expect(await sessionAccount('nobody')).toBeNull()
    })
    expect(db.user.findUnique).toHaveBeenCalledTimes(2)
  })
})

describe('the session token check', () => {
  const jwt = (token: Record<string, unknown> = {}) =>
    withRequestScope(() =>
      authOptions.callbacks!.jwt!({
        token: { ...mocks.cookie, ...token },
      } as never)
    )

  it('refreshes the token from the account and the browser session it read together', async () => {
    const expiresAt = new Date(Date.now() + 3_600_000)
    db.browserSession.findFirst.mockResolvedValue({
      id: 'browser-1',
      expiresAt,
      lastSeenAt: new Date(),
    })
    mocks.emailConfig.mockImplementation(async () => verificationRequired())
    const actor = await actorOf(async () => {
      expect(await jwt({ role: 'ADMIN' })).toEqual({
        id: stored.id,
        sessionVersion: stored.sessionVersion,
        sessionId: 'browser-1',
        authMethod: 'credentials',
        name: stored.name,
        email: stored.email,
        image: null,
        emailAccessRequired: true,
        sessionExpiresAt: expiresAt.toISOString(),
      })
    })
    expect(actor).toMatchObject({ actorId: stored.id, actorName: stored.name })
    expect(db.browserSession.findFirst).toHaveBeenCalledOnce()
    expect(db.browserSession.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'browser-1',
        userId: stored.id,
        sessionVersion: stored.sessionVersion,
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
    })
    expect(db.browserSession.updateMany).not.toHaveBeenCalled()
  })

  it('notes the activity of a session last seen over a minute ago', async () => {
    db.browserSession.findFirst.mockResolvedValue({
      id: 'browser-1',
      expiresAt: new Date(Date.now() + 3_600_000),
      lastSeenAt: new Date(Date.now() - 61_000),
    })
    await jwt()
    expect(db.browserSession.findFirst).toHaveBeenCalledOnce()
    expect(db.browserSession.updateMany).toHaveBeenCalledOnce()
  })

  // Each refusal is checked with every later check failing too, so the first
  // one that applies is the one reported.
  it.each([
    [
      'an account that no longer exists',
      () => db.user.findUnique.mockResolvedValue(null),
      'Session invalidated: User not found',
    ],
    [
      'a token from before the account signed out everywhere',
      () => {
        stored.sessionVersion = 4
        stored.passkeyRequired = true
      },
      'Session invalidated: Version mismatch',
    ],
    [
      'a password sign-in once the account requires a passkey',
      () => {
        stored.passkeyRequired = true
      },
      'Session invalidated: Passkey sign-in required',
    ],
    [
      'a browser session that was revoked or has expired',
      () => {},
      'Session invalidated: Session revoked or expired',
    ],
  ])('refuses %s', async (_case, arrange, message) => {
    db.browserSession.findFirst.mockResolvedValue(null)
    arrange()
    const actor = await actorOf(() =>
      expect(jwt()).rejects.toMatchObject({ message })
    )
    expect(actor.actorId).toBeUndefined()
    expect(db.browserSession.updateMany).not.toHaveBeenCalled()
  })

  it('refuses a token issued before browser sessions were recorded', async () => {
    await expect(jwt({ sessionId: undefined })).rejects.toThrow(
      'Session invalidated: Sign in again after upgrading.'
    )
    expect(db.browserSession.findFirst).not.toHaveBeenCalled()
  })

  it('accepts a passkey sign-in for an account that requires one', async () => {
    stored.passkeyRequired = true
    await expect(jwt({ authMethod: 'passkey' })).resolves.toMatchObject({
      id: stored.id,
    })
    await expect(
      jwt({ authMethod: 'passkey-recovery' })
    ).resolves.toMatchObject({ id: stored.id })
  })

  it('describes the session with the roles and permissions the token check read', async () => {
    const session = await withRequestScope(async () => {
      const token = await authOptions.callbacks!.jwt!({
        token: { ...mocks.cookie },
      } as never)
      return authOptions.callbacks!.session!({
        session: { user: {}, expires: '' },
        token,
      } as never)
    })
    const user = session.user as Session['user']
    expect(user).toMatchObject({
      id: stored.id,
      name: stored.name,
      email: stored.email,
      roles: [editor, everyone],
      sessionVersion: stored.sessionVersion,
      sessionId: 'browser-1',
    })
    expect([...user.permissions].sort()).toEqual([
      'files.read',
      'files.share',
      'files.upload',
    ])
    expect(db.user.findUnique).toHaveBeenCalledOnce()
  })

  it('gives a session whose account is gone no roles or permissions', async () => {
    db.user.findUnique.mockResolvedValue(null)
    const session = await authOptions.callbacks!.session!({
      session: { user: {}, expires: '' },
      token: { id: 'deleted', sessionVersion: 1 },
    } as never)
    expect(session.user).toMatchObject({ roles: [], permissions: [] })
  })
})

describe('the account behind a request', () => {
  it('answers a browser session with the account’s fields and nothing else', async () => {
    const actor = await actorOf(async () => {
      const user = await getAuthenticatedUser(request())
      expect(user).toEqual({
        id: stored.id,
        storageUsed: 12,
        urlId: 'alex1',
        vanityId: 'alex',
        roles: [editor, everyone],
        permissions: expect.any(Array),
        randomizeFileUrls: true,
        credential: 'session',
      })
      expect(Object.keys(user!).sort()).toEqual(authenticatedFields)
    })
    expect(actor).toMatchObject({ actorId: stored.id, actorName: stored.name })
    expect(actor.tokenId).toBeUndefined()
  })

  it('answers the legacy upload token with the same fields', async () => {
    mocks.cookie = null
    const actor = await actorOf(async () => {
      const user = await getAuthenticatedUser(request(bearer(legacyToken)))
      expect(user).toEqual({
        id: stored.id,
        storageUsed: 12,
        urlId: 'alex1',
        vanityId: 'alex',
        roles: [editor, everyone],
        permissions: expect.any(Array),
        randomizeFileUrls: true,
        credential: 'upload-token',
      })
      expect(Object.keys(user!).sort()).toEqual(authenticatedFields)
    })
    expect(actor).toMatchObject({ actorId: stored.id, actorName: stored.name })
    expect(db.user.findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { uploadToken: legacyToken },
      select: accountSelect,
    })
    expect(db.role.findUnique).toHaveBeenCalledOnce()
    expect(db.apiToken.findUnique).not.toHaveBeenCalled()
    expect(db.apiToken.update).not.toHaveBeenCalled()
  })

  it('answers a named token with its account, read with the token, and its binding', async () => {
    const actor = await actorOf(async () => {
      const user = await getAuthenticatedUser(request(bearer(namedSecret)))
      expect(user).toEqual({
        id: stored.id,
        storageUsed: 12,
        urlId: 'alex1',
        vanityId: 'alex',
        roles: [editor, everyone],
        permissions: expect.any(Array),
        randomizeFileUrls: true,
        credential: 'token',
        apiToken: {
          id: 'token-1',
          scopes: ['files:read'],
          profileId: 'profile-1',
        },
      })
      expect(Object.keys(user!).sort()).toEqual(
        [...authenticatedFields, 'apiToken'].sort()
      )
    })
    expect(actor).toMatchObject({
      actorId: stored.id,
      actorName: stored.name,
      tokenId: 'token-1',
    })
    expect(db.apiToken.findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { hash: hashApiToken(namedSecret) },
      include: { user: { select: accountSelect } },
    })
    // The token's read brought its account; the policy was read beside it.
    expect(db.user.findUnique).not.toHaveBeenCalled()
    expect(db.role.findUnique).toHaveBeenCalledOnce()
    expect(mocks.emailConfig).toHaveBeenCalledOnce()
    expect(db.apiToken.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'token-1' },
      data: { lastUsedAt: expect.any(Date) },
    })
  })

  it('names the actor before noting the token’s use, and waits for the note', async () => {
    let noted = false
    let actorWhenNoted: unknown
    db.apiToken.update.mockImplementation(async () => {
      actorWhenNoted = auditContext.getStore()?.actorId
      await new Promise((resolve) => setImmediate(resolve))
      noted = true
      return {}
    })
    await actorOf(async () => {
      await getAuthenticatedUser(request(bearer(namedSecret)))
      expect(noted).toBe(true)
    })
    expect(actorWhenNoted).toBe(stored.id)
  })

  it('accepts a named token whose use could not be noted', async () => {
    db.apiToken.update.mockRejectedValue(new Error('Database unavailable'))
    await expect(
      getAuthenticatedUser(request(bearer(namedSecret)))
    ).resolves.toMatchObject({ id: stored.id, credential: 'token' })
    expect(db.apiToken.update).toHaveBeenCalledOnce()
  })

  it.each([
    [
      'was revoked',
      () => {
        namedToken.revokedAt = new Date()
      },
    ],
    [
      'has expired',
      () => {
        namedToken.expiresAt = new Date(Date.now() - 1000)
      },
    ],
    [
      'lacks the scope the request needs',
      () => {
        namedToken.scopes = ['files:upload']
      },
    ],
    [
      'belongs to an account that must verify its email',
      () =>
        mocks.emailConfig.mockImplementation(async () =>
          verificationRequired()
        ),
    ],
    ['is unknown', () => db.apiToken.findUnique.mockResolvedValue(null)],
  ])(
    'refuses a named token that %s, without noting its use or naming an actor',
    async (_case, arrange) => {
      arrange()
      const actor = await actorOf(async () => {
        expect(
          await getAuthenticatedUser(request(bearer(namedSecret)))
        ).toBeNull()
      })
      expect(actor).toEqual({})
      expect(db.apiToken.update).not.toHaveBeenCalled()
      // A refused token never falls back to the browser's session.
      expect(db.user.findUnique).not.toHaveBeenCalled()
      expect(db.browserSession.findFirst).not.toHaveBeenCalled()
    }
  )

  it('refuses the browser session of an account that must verify its email', async () => {
    mocks.emailConfig.mockImplementation(async () => verificationRequired())
    const actor = await actorOf(async () => {
      expect(await getAuthenticatedUser(request())).toBeNull()
    })
    // The session token check has named the account whose session it is.
    expect(actor).toMatchObject({ actorId: stored.id, actorName: stored.name })
    expect(actor.tokenId).toBeUndefined()
    // Its own upload token is refused for the same reason.
    expect(await getAuthenticatedUser(request(bearer(legacyToken)))).toBeNull()
  })

  it('refuses the legacy upload token of an account that must verify its email, naming no actor', async () => {
    mocks.cookie = null
    mocks.emailConfig.mockImplementation(async () => verificationRequired())
    const actor = await actorOf(async () => {
      expect(
        await getAuthenticatedUser(request(bearer(legacyToken)))
      ).toBeNull()
    })
    expect(actor).toEqual({})
    expect(db.apiToken.update).not.toHaveBeenCalled()
  })

  it('refuses a request with no credentials and an upload token nobody holds', async () => {
    mocks.cookie = null
    const actor = await actorOf(async () => {
      expect(await getAuthenticatedUser(request())).toBeNull()
      expect(
        await getAuthenticatedUser(request(bearer('unknown-upload-token')))
      ).toBeNull()
    })
    expect(actor).toEqual({})
    expect(db.user.findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { uploadToken: 'unknown-upload-token' },
      select: accountSelect,
    })
  })
})
