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
  pair: vi.fn(),
  connection: vi.fn(),
  connectionUpdate: vi.fn(),
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
    agentToken: { findUnique: mocks.pair },
    agentConnection: {
      findUnique: mocks.connection,
      update: mocks.connectionUpdate,
    },
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

const ACCESS_TOKEN = 'fla_AccessTokenOfASignIn'
const signedIn = {
  id: 'connection-1',
  userId: 'user-1',
  clientId: 'flc_client',
  clientName: 'Claude Code (flare)',
  redirectUri: 'http://localhost:53124/callback',
  scopes: ['files:read', 'files:content', 'urls:read'],
  createdAt: new Date('2026-11-20T00:00:00.000Z'),
  lastUsedAt: null,
  revokedAt: null as Date | null,
  revokedReason: null as string | null,
  user: account,
}
const issued = {
  id: 'pair-1',
  connectionId: 'connection-1',
  accessHash: hashApiToken(ACCESS_TOKEN),
  accessExpiresAt: new Date(Date.now() + 3_600_000),
  refreshHash: hashApiToken('flf_RefreshTokenOfASignIn'),
  refreshExpiresAt: new Date(Date.now() + 90 * 86_400_000),
  narrowed: false,
  scopes: [] as string[],
  rotatedAt: null as Date | null,
  parentId: null,
}
let connections: (typeof signedIn)[]
let pairs: (typeof issued)[]

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
  connections = [signedIn]
  pairs = [issued]
  const connectionOf = (id: string) =>
    connections.find((connection) => connection.id === id) ?? null
  mocks.pair.mockImplementation(
    async ({ where }: { where: { accessHash?: string } }) => {
      const pair = pairs.find((row) => row.accessHash === where.accessHash)
      return pair
        ? { ...pair, connection: connectionOf(pair.connectionId) }
        : null
    }
  )
  mocks.connection.mockImplementation(
    async ({ where }: { where: { id: string } }) => connectionOf(where.id)
  )
  mocks.connectionUpdate.mockResolvedValue({})
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
const withConnection = (override: Partial<typeof signedIn>) => {
  connections = [{ ...signedIn, ...override }]
}
const withPair = (override: Partial<typeof issued>) => {
  pairs = [{ ...issued, ...override }]
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
    'flf_RefreshTokenOfASignIn',
    'flc_client',
    'eyJhbGciOiJIUzI1NiJ9.session.jwt',
    'Flr_AgentToken',
    'Fla_AccessTokenOfASignIn',
    'FLA_AccessTokenOfASignIn',
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
      // Nor an access token: only the `fla_` prefix is one.
      expect(mocks.pair).not.toHaveBeenCalled()
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

describe('authenticateAgent with the access token of a sign-in', () => {
  const authenticate = (value = ACCESS_TOKEN) =>
    authenticateAgent(request(`Bearer ${value}`))

  it('accepts an unexpired access token of a live connection, as its account', async () => {
    const principal = await authenticate()
    expect(principal).not.toBeNull()
    expect(principal!.user).toMatchObject({
      id: 'user-1',
      storageUsed: 12.5,
      urlId: 'alex',
      credential: 'agent',
      agentConnection: {
        id: 'connection-1',
        scopes: ['files:read', 'files:content', 'urls:read'],
      },
    })
    expect(principal!.name).toBe('Alex')
    expect(principal!.scopes).toEqual([
      'files:read',
      'files:content',
      'urls:read',
    ])
    expect(principal!.credentialKey).toBe('connection:connection-1')
    expect(mocks.pair).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accessHash: hashApiToken(ACCESS_TOKEN) },
      })
    )
    expectNoOtherCredentialTried()
  })

  it('is not a named token: nothing looks one up, and the user carries none', async () => {
    const principal = await authenticate()
    expect(principal!.user.apiToken).toBeUndefined()
    expect(mocks.token).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('returns no secret of the account, the connection or the pair', async () => {
    const serialized = JSON.stringify(await authenticate())
    expect(serialized).not.toContain(ACCESS_TOKEN)
    expect(serialized).not.toContain(issued.accessHash)
    expect(serialized).not.toContain(issued.refreshHash)
    expect(serialized).not.toContain('alex@example.com')
  })

  it('names the account and the connection as the audit actor', async () => {
    const context: { actorId?: string; actorName?: string; tokenId?: string } =
      {}
    await auditContext.run(context, () => authenticate())
    expect(context).toEqual({
      actorId: 'user-1',
      actorName: 'Alex',
      tokenId: 'connection:connection-1',
    })
  })

  it('records when the connection was used, and still answers if that write fails', async () => {
    await authenticate()
    expect(mocks.connectionUpdate).toHaveBeenCalledWith({
      where: { id: 'connection-1' },
      data: { lastUsedAt: expect.any(Date) },
    })
    mocks.connectionUpdate.mockRejectedValue(new Error('database is read-only'))
    expect(await authenticate()).not.toBeNull()
  })

  it('compares the token value exactly', async () => {
    for (const value of [
      'fla_accesstokenofasignin',
      'fla_AccessTokenOfASignIn2',
      'fla_AccessTokenOfASignI',
      'fla_',
    ])
      expect(await authenticate(value)).toBeNull()
    expect(mocks.connectionUpdate).not.toHaveBeenCalled()
    expectNoOtherCredentialTried()
  })

  it.each<[string, Partial<typeof issued>]>([
    ['expired a second ago', { accessExpiresAt: new Date(Date.now() - 1000) }],
    ['expired long ago', { accessExpiresAt: new Date(0) }],
  ])('refuses an access token that %s', async (_what, override) => {
    withPair(override)
    expect(await authenticate()).toBeNull()
    expect(mocks.connectionUpdate).not.toHaveBeenCalled()
    expectNoOtherCredentialTried()
  })

  it('accepts an access token until it expires, even after its refresh token was rotated', async () => {
    withPair({
      accessExpiresAt: new Date(Date.now() + 1000),
      rotatedAt: new Date(Date.now() - 30_000),
    })
    expect(await authenticate()).not.toBeNull()
  })

  it.each<[string, Partial<typeof signedIn>]>([
    ['disconnected', { revokedAt: new Date(), revokedReason: 'disconnected' }],
    [
      'revoked after a replay',
      { revokedAt: new Date(0), revokedReason: 'replay' },
    ],
  ])(
    'refuses the token of a connection that was %s',
    async (_what, override) => {
      withConnection(override)
      expect(await authenticate()).toBeNull()
      expect(mocks.connectionUpdate).not.toHaveBeenCalled()
      expectNoOtherCredentialTried()
    }
  )

  it('refuses a token whose connection is gone', async () => {
    connections = []
    expect(await authenticate()).toBeNull()
  })

  it('refuses an account that must verify its email first', async () => {
    mocks.policy.mockReturnValue(true)
    expect(await authenticate()).toBeNull()
    expect(mocks.policy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      expect.anything()
    )
    expect(mocks.connectionUpdate).not.toHaveBeenCalled()
  })

  it('refuses a refresh token presented as an access token', async () => {
    expect(await authenticate('flf_RefreshTokenOfASignIn')).toBeNull()
    expect(mocks.pair).not.toHaveBeenCalled()
  })

  describe('its scopes', () => {
    it('are the grant of the connection when the pair has no ceiling of its own', async () => {
      withConnection({ scopes: ['files:upload', 'files:read'] })
      expect((await authenticate())!.scopes).toEqual([
        'files:upload',
        'files:read',
      ])
    })

    it('are the grant within the ceiling of a narrowed pair', async () => {
      withPair({ narrowed: true, scopes: ['files:read', 'files:delete'] })
      const principal = await authenticate()
      // files:delete is in the ceiling but was never granted.
      expect(principal!.scopes).toEqual(['files:read'])
      expect(principal!.user.agentConnection!.scopes).toEqual(['files:read'])
    })

    it('ignore the scopes column of a pair that is not narrowed', async () => {
      withPair({ narrowed: false, scopes: ['files:read'] })
      expect((await authenticate())!.scopes).toEqual([
        'files:read',
        'files:content',
        'urls:read',
      ])
    })

    it('follow an edit of the connection on the very next request', async () => {
      expect((await authenticate())!.scopes).toContain('files:content')
      withConnection({ scopes: ['files:read'] })
      expect((await authenticate())!.scopes).toEqual(['files:read'])
      withConnection({ scopes: [] })
      expect((await authenticate())!.scopes).toEqual([])
    })

    it('are empty when a narrowed pair and the grant no longer overlap', async () => {
      withPair({ narrowed: true, scopes: ['urls:read'] })
      withConnection({ scopes: ['files:read'] })
      expect((await authenticate())!.scopes).toEqual([])
    })

    it('never hold the marker, or a scope a sign-in cannot grant', async () => {
      withConnection({ scopes: ['mcp', 'files:read', 'admin:everything'] })
      withPair({
        narrowed: true,
        scopes: ['mcp', 'files:read', 'admin:everything'],
      })
      expect((await authenticate())!.scopes).toEqual(['files:read'])
    })

    it('are not permissions: the role still decides', async () => {
      mocks.everyone.mockResolvedValue(role('everyone', [], 'everyone'))
      withConnection({ scopes: ['files:read', 'files:delete'] })
      const principal = await authenticate()
      expect(principal!.can('files.read')).toBe(false)
      expect(principal!.can('files.delete')).toBe(false)
    })
  })

  it('acts as the connection, not as a session on the same request', async () => {
    const principal = await authenticateAgent(
      request(`Bearer ${ACCESS_TOKEN}`, SESSION_COOKIE)
    )
    expect(principal!.user.credential).toBe('agent')
    expect(principal!.user.id).toBe('user-1')
    expectNoOtherCredentialTried()
  })

  it('refuses an unknown access token instead of using the cookie', async () => {
    expect(
      await authenticateAgent(
        request('Bearer fla_NobodyIssuedThis', SESSION_COOKIE)
      )
    ).toBeNull()
    expectNoOtherCredentialTried()
  })
})

describe('credentialPrincipal for a connection', () => {
  it('finds the principal a transfer URL was made for, with the whole grant', async () => {
    // The pair the URL was made with was narrowed; the URL belongs to the connection.
    withPair({ narrowed: true, scopes: ['files:read'] })
    const principal = await credentialPrincipal('connection:connection-1')
    expect(mocks.connection).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'connection-1' } })
    )
    expect(principal).toMatchObject({
      name: 'Alex',
      scopes: ['files:read', 'files:content', 'urls:read'],
      credentialKey: 'connection:connection-1',
      user: {
        id: 'user-1',
        credential: 'agent',
        agentConnection: { id: 'connection-1' },
      },
    })
    // Following a transfer URL is not a use of the connection itself.
    expect(mocks.connectionUpdate).not.toHaveBeenCalled()
    expect(mocks.pair).not.toHaveBeenCalled()
    expect(mocks.token).not.toHaveBeenCalled()
    expectNoOtherCredentialTried()
  })

  it('outlives a refresh: it does not depend on any one pair', async () => {
    pairs = []
    expect(await credentialPrincipal('connection:connection-1')).not.toBeNull()
  })

  it.each<[string, Partial<typeof signedIn>]>([
    ['disconnected', { revokedAt: new Date(), revokedReason: 'disconnected' }],
    ['revoked', { revokedAt: new Date(0), revokedReason: 'sessions-revoked' }],
  ])('answers null once the connection is %s', async (_what, override) => {
    withConnection(override)
    expect(await credentialPrincipal('connection:connection-1')).toBeNull()
  })

  it('answers null for a connection that was deleted', async () => {
    expect(await credentialPrincipal('connection:gone')).toBeNull()
  })

  it('answers null once the account must verify its email', async () => {
    mocks.policy.mockReturnValue(true)
    expect(await credentialPrincipal('connection:connection-1')).toBeNull()
  })

  it('reflects the grant and the role as they are now', async () => {
    withConnection({
      scopes: ['files:read'],
      user: { ...account, roles: [role('reader', ['files.read'])] },
    })
    mocks.everyone.mockResolvedValue(role('everyone', [], 'everyone'))
    const principal = await credentialPrincipal('connection:connection-1')
    expect(principal!.scopes).toEqual(['files:read'])
    expect(principal!.can('files.read')).toBe(true)
    expect(principal!.can('files.upload')).toBe(false)
  })

  it('never reads a token row for a connection key, or a connection for a token key', async () => {
    await credentialPrincipal('connection:token-1')
    expect(mocks.token).not.toHaveBeenCalled()
    await credentialPrincipal('token:connection-1')
    expect(mocks.connection).toHaveBeenCalledTimes(1)
  })

  it.each([
    'connection',
    'connection:',
    ':connection-1',
    'connections:connection-1',
  ])('answers null for the key %j without reading anything', async (key) => {
    expect(await credentialPrincipal(key)).toBeNull()
    expect(mocks.connection).not.toHaveBeenCalled()
    expect(mocks.token).not.toHaveBeenCalled()
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
