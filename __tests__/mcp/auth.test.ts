import { beforeEach, describe, expect, it, vi } from 'vitest'

import { auditContext } from '@/lib/audit/context'
import { hashApiToken } from '@/lib/integrations/tokens'
import { authenticateAgent, credentialPrincipal } from '@/lib/mcp/auth'
import { DEFAULT_PERMISSIONS } from '@/lib/permissions/catalog'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  serverSession: vi.fn(),
  token: vi.fn(),
  update: vi.fn(),
  user: vi.fn(),
  everyone: vi.fn(),
  policy: vi.fn(),
}))
// Both would answer an administrator if anything asked them.
vi.mock('@/lib/auth', () => ({
  authOptions: {},
  getAccessSession: mocks.session,
}))
vi.mock('next-auth', () => ({ getServerSession: mocks.serverSession }))
vi.mock('next-auth/next', () => ({ getServerSession: mocks.serverSession }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    apiToken: { findUnique: mocks.token, update: mocks.update },
    user: { findUnique: mocks.user, findFirst: mocks.user },
    role: { findUnique: mocks.everyone },
  },
}))
vi.mock('@/lib/email/config', () => ({
  getEmailConfig: vi.fn(async () => ({})),
}))
vi.mock('@/lib/email/policy', () => ({
  requiresEmailVerification: mocks.policy,
}))

const role = (
  id: string,
  permissions: string[],
  systemKey: string | null = null
) => ({
  id,
  name: id,
  description: '',
  color: '#000000',
  position: systemKey === 'everyone' ? 0 : 10,
  systemKey,
  permissions,
})

const account = {
  id: 'user-1',
  name: 'Alex',
  email: 'alex@example.com',
  image: null,
  sessionVersion: 3,
  passkeyRequired: false,
  emailVerified: null,
  emailVerifiedFor: null,
  emailVerificationSource: null,
  emailExempt: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  storageUsed: 12.5,
  urlId: 'alex',
  vanityId: null,
  randomizeFileUrls: true,
  roles: [] as ReturnType<typeof role>[],
}
const stored = {
  id: 'token-1',
  userId: 'user-1',
  name: 'Agent',
  hash: hashApiToken('flr_AgentToken'),
  scopes: ['files:read', 'files:content', 'mcp'],
  profileId: 'profile-1' as string | null,
  revokedAt: null as Date | null,
  expiresAt: null as Date | null,
  lastUsedAt: null,
  user: account,
}
/** Like the database, a lookup finds a row only by its exact key. */
let tokens: (typeof stored)[]

beforeEach(() => {
  vi.clearAllMocks()
  tokens = [stored]
  mocks.token.mockImplementation(
    async ({ where }: { where: { hash?: string; id?: string } }) =>
      tokens.find((token) =>
        where.hash ? token.hash === where.hash : token.id === where.id
      ) ?? null
  )
  mocks.update.mockResolvedValue({})
  mocks.user.mockResolvedValue({
    ...account,
    roles: [role('admin', ['administrator'])],
  })
  mocks.everyone.mockResolvedValue(
    role('everyone', [...DEFAULT_PERMISSIONS], 'everyone')
  )
  mocks.policy.mockReturnValue(false)
  mocks.session.mockResolvedValue({ user: { id: 'admin' } })
  mocks.serverSession.mockResolvedValue({ user: { id: 'admin' } })
})

const SESSION_COOKIE =
  'next-auth.session-token=signed-in-administrator; __Secure-next-auth.session-token=signed-in-administrator'

function request(authorization?: string, cookie?: string) {
  const headers = new Headers()
  if (authorization !== undefined) headers.set('authorization', authorization)
  if (cookie) headers.set('cookie', cookie)
  return new Request('https://flare.test/api/mcp', { method: 'POST', headers })
}
const withToken = (override: Partial<typeof stored>) => {
  tokens = [{ ...stored, ...override }]
}

function expectNoOtherCredentialTried() {
  expect(mocks.session).not.toHaveBeenCalled()
  expect(mocks.serverSession).not.toHaveBeenCalled()
  // The legacy upload token is looked up in the user table; nothing here is.
  expect(mocks.user).not.toHaveBeenCalled()
}

describe('authenticateAgent', () => {
  it('accepts a usable named token that carries the mcp marker', async () => {
    const principal = await authenticateAgent(request('Bearer flr_AgentToken'))
    expect(principal).not.toBeNull()
    expect(principal!.user).toMatchObject({
      id: 'user-1',
      storageUsed: 12.5,
      urlId: 'alex',
      vanityId: null,
      randomizeFileUrls: true,
      credential: 'token',
    })
    expect(principal!.name).toBe('Alex')
    expect(principal!.credentialKey).toBe('token:token-1')
    expect(mocks.token).toHaveBeenCalledWith(
      expect.objectContaining({ where: { hash: stored.hash } })
    )
    expectNoOtherCredentialTried()
  })

  it('leaves the marker out of the scopes the connection acts with', async () => {
    const principal = await authenticateAgent(request('Bearer flr_AgentToken'))
    expect(principal!.scopes).toEqual(['files:read', 'files:content'])
    expect(principal!.scopes).not.toContain('mcp')
  })

  it('keeps the token bound to its upload profile', async () => {
    const principal = await authenticateAgent(request('Bearer flr_AgentToken'))
    expect(principal!.user.apiToken).toEqual({
      id: 'token-1',
      scopes: ['files:read', 'files:content', 'mcp'],
      profileId: 'profile-1',
    })
    withToken({ profileId: null })
    expect(
      (await authenticateAgent(request('Bearer flr_AgentToken')))!.user.apiToken
        ?.profileId
    ).toBeNull()
  })

  it('returns no secret of the account or the token', async () => {
    const principal = await authenticateAgent(request('Bearer flr_AgentToken'))
    const serialized = JSON.stringify(principal)
    expect(serialized).not.toContain('flr_AgentToken')
    expect(serialized).not.toContain(stored.hash)
    expect(principal!.user).not.toHaveProperty('email')
    expect(principal!.user).not.toHaveProperty('sessionVersion')
  })

  it('names the account and the token as the audit actor', async () => {
    const context: { actorId?: string; actorName?: string; tokenId?: string } =
      {}
    await auditContext.run(context, () =>
      authenticateAgent(request('Bearer flr_AgentToken'))
    )
    expect(context).toMatchObject({
      actorId: 'user-1',
      actorName: 'Alex',
      tokenId: 'token-1',
    })
  })

  it('records when the token was used, and still answers if that write fails', async () => {
    await authenticateAgent(request('Bearer flr_AgentToken'))
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'token-1' },
      data: { lastUsedAt: expect.any(Date) },
    })
    mocks.update.mockRejectedValue(new Error('database is read-only'))
    expect(
      await authenticateAgent(request('Bearer flr_AgentToken'))
    ).not.toBeNull()
  })

  it.each(['Bearer', 'bearer', 'BEARER', 'bEaReR', 'Bearer  '])(
    'reads the %s scheme in any letter case',
    async (scheme) => {
      const principal = await authenticateAgent(
        request(`${scheme} flr_AgentToken`)
      )
      expect(principal?.user.id).toBe('user-1')
    }
  )

  it('compares the token value exactly', async () => {
    for (const value of ['flr_agenttoken', 'flr_AGENTTOKEN', 'flr_AgentToken2'])
      expect(await authenticateAgent(request(`Bearer ${value}`))).toBeNull()
    expect(mocks.token).toHaveBeenCalledTimes(3)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('refuses a request without an Authorization header', async () => {
    expect(await authenticateAgent(request())).toBeNull()
    expect(mocks.token).not.toHaveBeenCalled()
    expectNoOtherCredentialTried()
  })

  it.each([
    'legacy-upload-token',
    'fla_AccessTokenFromALaterChange',
    'eyJhbGciOiJIUzI1NiJ9.session.jwt',
    'Flr_AgentToken',
  ])(
    'never looks up the bearer value %s, which is not a named token',
    async (value) => {
      // The account's legacy upload token would match if anything asked.
      mocks.user.mockImplementation(
        async ({ where }: { where: { uploadToken?: string } }) =>
          where.uploadToken ? account : null
      )
      expect(await authenticateAgent(request(`Bearer ${value}`))).toBeNull()
      expect(mocks.token).not.toHaveBeenCalled()
      expect(mocks.user).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ uploadToken: expect.anything() }),
        })
      )
      expectNoOtherCredentialTried()
    }
  )

  it.each([
    'Basic flr_AgentToken',
    'Bearerflr_AgentToken',
    'Bearer',
    'Bearer ',
    'Bearer\tflr_AgentToken',
    'Token flr_AgentToken',
    'flr_AgentToken',
    '',
  ])('does not read the header %j as a bearer credential', async (header) => {
    expect(await authenticateAgent(request(header))).toBeNull()
    expect(mocks.token).not.toHaveBeenCalled()
    expectNoOtherCredentialTried()
  })

  it('refuses a named token that does not carry the mcp marker', async () => {
    // A token made for a script, with every other scope there is.
    withToken({
      scopes: [
        'files:upload',
        'files:read',
        'files:content',
        'files:organize',
        'files:share',
        'files:delete',
        'urls:read',
        'urls:write',
      ],
    })
    expect(await authenticateAgent(request('Bearer flr_AgentToken'))).toBeNull()
    expect(mocks.update).not.toHaveBeenCalled()
    expectNoOtherCredentialTried()
  })

  it('accepts a token that carries nothing but the marker', async () => {
    withToken({ scopes: ['mcp'] })
    const principal = await authenticateAgent(request('Bearer flr_AgentToken'))
    expect(principal!.scopes).toEqual([])
  })

  it.each<[string, Partial<typeof stored>]>([
    ['a revoked token', { revokedAt: new Date(Date.now() - 1000) }],
    ['an expired token', { expiresAt: new Date(Date.now() - 1000) }],
    ['a token that expires this instant', { expiresAt: new Date(0) }],
  ])('refuses %s', async (_what, override) => {
    withToken(override)
    expect(await authenticateAgent(request('Bearer flr_AgentToken'))).toBeNull()
    expect(mocks.update).not.toHaveBeenCalled()
    expectNoOtherCredentialTried()
  })

  it('accepts a token until its expiry', async () => {
    withToken({ expiresAt: new Date(Date.now() + 60_000) })
    expect(
      await authenticateAgent(request('Bearer flr_AgentToken'))
    ).not.toBeNull()
  })

  it('refuses a token nobody issued', async () => {
    expect(await authenticateAgent(request('Bearer flr_Unknown'))).toBeNull()
    expect(mocks.token).toHaveBeenCalledWith(
      expect.objectContaining({ where: { hash: hashApiToken('flr_Unknown') } })
    )
    expectNoOtherCredentialTried()
  })

  it('refuses an account that must verify its email first, as the REST API does', async () => {
    mocks.policy.mockReturnValue(true)
    expect(await authenticateAgent(request('Bearer flr_AgentToken'))).toBeNull()
    expect(mocks.policy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      expect.anything()
    )
    expect(mocks.update).not.toHaveBeenCalled()
  })

  describe('with a signed-in browser session on the same request', () => {
    it('acts as the token, not the session', async () => {
      const principal = await authenticateAgent(
        request('Bearer flr_AgentToken', SESSION_COOKIE)
      )
      expect(principal!.user.id).toBe('user-1')
      expect(principal!.user.credential).toBe('token')
      expect(principal!.can('users.delete')).toBe(false)
      expectNoOtherCredentialTried()
    })

    it.each<[string, string | undefined]>([
      ['no Authorization header', undefined],
      [
        'a bearer value that is not a named token',
        'Bearer legacy-upload-token',
      ],
      ['a named token nobody issued', 'Bearer flr_Unknown'],
      ['another scheme', 'Basic YWRtaW46YWRtaW4='],
    ])('refuses %s instead of using the cookie', async (_what, header) => {
      expect(
        await authenticateAgent(request(header, SESSION_COOKIE))
      ).toBeNull()
      expectNoOtherCredentialTried()
    })

    it('refuses a token without the marker instead of using the cookie', async () => {
      withToken({ scopes: ['files:read'] })
      expect(
        await authenticateAgent(
          request('Bearer flr_AgentToken', SESSION_COOKIE)
        )
      ).toBeNull()
      expectNoOtherCredentialTried()
    })
  })

  describe('what the account may do', () => {
    it("follows the account's roles and the Everyone role", async () => {
      withToken({
        user: {
          ...account,
          roles: [role('uploader', ['files.upload', 'folders.manage'])],
        },
      })
      mocks.everyone.mockResolvedValue(
        role('everyone', ['files.read', 'links.read'], 'everyone')
      )
      const principal = await authenticateAgent(
        request('Bearer flr_AgentToken')
      )
      // Its own role's.
      expect(principal!.can('files.upload')).toBe(true)
      expect(principal!.can('folders.manage')).toBe(true)
      // Everyone's.
      expect(principal!.can('files.read')).toBe(true)
      expect(principal!.can('links.read')).toBe(true)
      // Nobody's.
      expect(principal!.can('files.delete')).toBe(false)
      expect(principal!.can('administrator')).toBe(false)
      expect(principal!.user.permissions.sort()).toEqual([
        'files.read',
        'files.upload',
        'folders.manage',
        'links.read',
      ])
      expect(principal!.user.roles.map(({ id }) => id)).toEqual([
        'uploader',
        'everyone',
      ])
    })

    it('holds only what Everyone holds when the account has no role of its own', async () => {
      mocks.everyone.mockResolvedValue(
        role('everyone', ['files.read'], 'everyone')
      )
      const principal = await authenticateAgent(
        request('Bearer flr_AgentToken')
      )
      expect(principal!.can('files.read')).toBe(true)
      expect(principal!.can('files.upload')).toBe(false)
    })

    it('holds nothing when no role grants anything', async () => {
      mocks.everyone.mockResolvedValue(null)
      const principal = await authenticateAgent(
        request('Bearer flr_AgentToken')
      )
      expect(principal!.can('files.read')).toBe(false)
      expect(principal!.user.permissions).toEqual([])
    })

    it('lets an administrator do everything a role can allow', async () => {
      withToken({
        user: { ...account, roles: [role('admin', ['administrator'])] },
      })
      const principal = await authenticateAgent(
        request('Bearer flr_AgentToken')
      )
      expect(principal!.can('files.delete')).toBe(true)
      expect(principal!.can('settings.security')).toBe(true)
      // The scopes still decide what the connection may do with that.
      expect(principal!.scopes).toEqual(['files:read', 'files:content'])
    })

    it('does not take scopes for permissions', async () => {
      mocks.everyone.mockResolvedValue(role('everyone', [], 'everyone'))
      withToken({ scopes: ['mcp', 'files:read', 'files:delete'] })
      const principal = await authenticateAgent(
        request('Bearer flr_AgentToken')
      )
      expect(principal!.can('files.read')).toBe(false)
      expect(principal!.can('files.delete')).toBe(false)
    })
  })
})

describe('credentialPrincipal', () => {
  it('finds the principal a transfer URL was made for by its credential key', async () => {
    const live = await authenticateAgent(request('Bearer flr_AgentToken'))
    vi.clearAllMocks()
    const principal = await credentialPrincipal(live!.credentialKey)
    expect(mocks.token).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'token-1' } })
    )
    expect(principal).toMatchObject({
      name: 'Alex',
      scopes: ['files:read', 'files:content'],
      credentialKey: 'token:token-1',
      user: {
        id: 'user-1',
        credential: 'token',
        apiToken: { id: 'token-1', profileId: 'profile-1' },
      },
    })
    expect(principal!.can('files.read')).toBe(true)
    // Following a transfer URL is not a use of the token itself.
    expect(mocks.update).not.toHaveBeenCalled()
    expectNoOtherCredentialTried()
  })

  it.each<[string, Partial<typeof stored>]>([
    ['revoked', { revokedAt: new Date(Date.now() - 1000) }],
    ['expired', { expiresAt: new Date(Date.now() - 1000) }],
    ['no longer marked for MCP', { scopes: ['files:read', 'files:content'] }],
  ])('answers null once the token is %s', async (_what, override) => {
    withToken(override)
    expect(await credentialPrincipal('token:token-1')).toBeNull()
  })

  it('answers null once the account must verify its email', async () => {
    mocks.policy.mockReturnValue(true)
    expect(await credentialPrincipal('token:token-1')).toBeNull()
  })

  it('answers null for a token that was deleted', async () => {
    expect(await credentialPrincipal('token:gone')).toBeNull()
  })

  it('reflects the scopes and role as they are now, not as they were', async () => {
    withToken({
      scopes: ['mcp', 'files:read'],
      user: { ...account, roles: [role('reader', ['files.read'])] },
    })
    mocks.everyone.mockResolvedValue(role('everyone', [], 'everyone'))
    const principal = await credentialPrincipal('token:token-1')
    expect(principal!.scopes).toEqual(['files:read'])
    expect(principal!.can('files.read')).toBe(true)
    expect(principal!.can('files.upload')).toBe(false)
  })

  it.each([
    '',
    'token',
    'token:',
    ':token-1',
    'agent:token-1',
    'token-1',
    'user:user-1',
  ])('answers null for the key %j without reading anything', async (key) => {
    expect(await credentialPrincipal(key)).toBeNull()
    expect(mocks.token).not.toHaveBeenCalled()
    expectNoOtherCredentialTried()
  })
})
