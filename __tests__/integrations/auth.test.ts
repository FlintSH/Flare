import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getAuthenticatedUser } from '@/lib/auth/api-auth'
import { hashApiToken } from '@/lib/integrations/tokens'
import { DEFAULT_PERMISSIONS } from '@/lib/permissions/catalog'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  token: vi.fn(),
  user: vi.fn(),
  userUpdateMany: vi.fn(),
  update: vi.fn(),
  policy: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getAccessSession: mocks.session }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    apiToken: { findUnique: mocks.token, update: mocks.update },
    user: { findUnique: mocks.user, updateMany: mocks.userUpdateMany },
    role: {
      findUnique: vi.fn(async () => ({
        id: 'everyone',
        name: 'Everyone',
        position: 0,
        systemKey: 'everyone',
        permissions: [...DEFAULT_PERMISSIONS],
      })),
    },
  },
}))
vi.mock('@/lib/email/config', () => ({
  getEmailConfig: vi.fn(async () => ({})),
}))
vi.mock('@/lib/email/policy', () => ({
  requiresEmailVerification: mocks.policy,
}))

const token = {
  id: 'token-1',
  scopes: ['files:upload'],
  profileId: 'profile-1',
  predatesEncryption: false,
  revokedAt: null,
  expiresAt: null,
  user: {
    id: 'user-1',
    storageUsed: 0,
    urlId: 'u',
    vanityId: null,
    roles: [],
    permissions: [...DEFAULT_PERMISSIONS],
    randomizeFileUrls: true,
    password: 'never-return',
  },
}
// Like the database, a lookup finds a row only by its exact stored key.
const storedTokens = new Map([
  [hashApiToken('flr_test'), token],
  [hashApiToken('flr_MixedCaseToken'), token],
])
const legacyToken = 'legacy-MixedCaseToken'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.token.mockImplementation(
    async ({ where }: { where: { hash: string } }) =>
      storedTokens.get(where.hash) ?? null
  )
  mocks.user.mockImplementation(
    async ({ where }: { where: { id?: string; uploadTokenHash?: string } }) =>
      where.id === token.user.id ||
      where.uploadTokenHash === hashApiToken(legacyToken)
        ? {
            ...token.user,
            uploadTokenHash: hashApiToken(legacyToken),
            uploadTokenUsedAt: null,
          }
        : null
  )
  mocks.update.mockResolvedValue({})
  mocks.userUpdateMany.mockResolvedValue({ count: 1 })
  mocks.policy.mockReturnValue(false)
  mocks.session.mockResolvedValue(null)
})
const request = (
  path: string,
  method = 'POST',
  authorization = 'Bearer flr_test'
) =>
  new Request(`https://flare.test${path}`, {
    method,
    headers: { authorization },
  })

describe('named bearer authentication', () => {
  it('exposes binding and scopes without returning credentials', async () => {
    const user = await getAuthenticatedUser(request('/api/files'))
    expect(user?.apiToken).toEqual({
      id: 'token-1',
      scopes: ['files:upload'],
      profileId: 'profile-1',
      predatesEncryption: false,
    })
    expect(user).not.toHaveProperty('password')
    // The token owner's access, not an empty one for an unknown account.
    expect(user?.roles.map((role) => role.id)).toEqual(['everyone'])
  })
  it.each(['Bearer', 'bearer', 'BEARER', 'bEaReR', 'Bearer  '])(
    'accepts the %s scheme without changing the named token value',
    async (scheme) => {
      const user = await getAuthenticatedUser(
        request('/api/files', 'POST', `${scheme} flr_MixedCaseToken`)
      )
      expect(user?.id).toBe('user-1')
      expect(mocks.session).not.toHaveBeenCalled()
    }
  )
  it.each(['Bearer', 'bearer', 'bEaReR'])(
    'does not upgrade a scoped %s token to a coexisting administrator session',
    async (scheme) => {
      mocks.session.mockResolvedValue({ user: { id: 'admin' } })
      expect(
        await getAuthenticatedUser(
          request('/api/profile/upload-token', 'GET', `${scheme} flr_test`)
        )
      ).toBeNull()
      expect(mocks.session).not.toHaveBeenCalled()
      expect(mocks.user).not.toHaveBeenCalled()
    }
  )
  it('does not fall back to a session when a lowercase bearer token is invalid', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'admin' } })
    mocks.token.mockResolvedValue(null)
    expect(
      await getAuthenticatedUser(
        request('/api/files', 'POST', 'bearer flr_invalid')
      )
    ).toBeNull()
    expect(mocks.session).not.toHaveBeenCalled()
    expect(mocks.user).not.toHaveBeenCalled()
  })
  it.each([
    { revokedAt: new Date() },
    { expiresAt: new Date(0) },
    { scopes: ['files:read'] },
  ])('rejects invalid authority %o', async (override) => {
    mocks.token.mockResolvedValue({ ...token, ...override })
    expect(await getAuthenticatedUser(request('/api/files'))).toBeNull()
  })
  it('enforces account verification requirements', async () => {
    mocks.policy.mockReturnValue(true)
    expect(await getAuthenticatedUser(request('/api/files'))).toBeNull()
  })
  it.each(['Bearer', 'bearer', 'BEARER', 'bEaReR', 'Bearer  '])(
    'preserves legacy token authentication with the %s scheme',
    async (scheme) => {
      const result = await getAuthenticatedUser(
        request('/api/files', 'POST', `${scheme} ${legacyToken}`)
      )
      expect(result?.id).toBe('user-1')
      expect(mocks.token).not.toHaveBeenCalled()
    }
  )
  it('finds the legacy token by its hash and never by the token itself', async () => {
    const result = await getAuthenticatedUser(
      request('/api/files', 'POST', `Bearer ${legacyToken}`)
    )
    expect(result?.credential).toBe('upload-token')
    expect(result?.apiToken).toBeUndefined()
    // The hash columns stay inside the lookup.
    expect(result).not.toHaveProperty('uploadTokenHash')
    expect(result).not.toHaveProperty('uploadTokenUsedAt')
    const where = mocks.user.mock.calls[0][0].where
    expect(where).toEqual({ uploadTokenHash: hashApiToken(legacyToken) })
    expect(JSON.stringify(mocks.user.mock.calls)).not.toContain(legacyToken)
    // The use is recorded, by the hash, for the warning in the application.
    expect(mocks.userUpdateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', uploadTokenHash: hashApiToken(legacyToken) },
      data: { uploadTokenUsedAt: expect.any(Date) },
    })
  })
  it('records a legacy token use at most once an hour, and a failed write does not refuse the request', async () => {
    const stored = (usedAt: Date) =>
      mocks.user.mockResolvedValue({
        ...token.user,
        uploadTokenHash: hashApiToken(legacyToken),
        uploadTokenUsedAt: usedAt,
      })
    stored(new Date(Date.now() - 60_000))
    const legacy = () =>
      getAuthenticatedUser(
        request('/api/files', 'POST', `Bearer ${legacyToken}`)
      )
    expect((await legacy())?.id).toBe('user-1')
    expect(mocks.userUpdateMany).not.toHaveBeenCalled()
    stored(new Date(Date.now() - 2 * 3_600_000))
    mocks.userUpdateMany.mockRejectedValue(new Error('database is busy'))
    expect((await legacy())?.id).toBe('user-1')
    expect(mocks.userUpdateMany).toHaveBeenCalledOnce()
  })
  it('refuses a token that is not the stored one, and a revoked legacy token', async () => {
    expect(
      await getAuthenticatedUser(
        request('/api/files', 'POST', 'Bearer legacy-mixedcasetoken')
      )
    ).toBeNull()
    // A row that the index returned with a different hash is not trusted.
    mocks.user.mockResolvedValue({
      ...token.user,
      uploadTokenHash: hashApiToken('another token'),
      uploadTokenUsedAt: null,
    })
    expect(
      await getAuthenticatedUser(
        request('/api/files', 'POST', `Bearer ${legacyToken}`)
      )
    ).toBeNull()
    mocks.user.mockResolvedValue({
      ...token.user,
      uploadTokenHash: null,
      uploadTokenUsedAt: null,
    })
    expect(
      await getAuthenticatedUser(
        request('/api/files', 'POST', `Bearer ${legacyToken}`)
      )
    ).toBeNull()
  })
  it('marks a named token from before encryption', async () => {
    mocks.token.mockResolvedValue({ ...token, predatesEncryption: true })
    const user = await getAuthenticatedUser(request('/api/files'))
    expect(user?.apiToken?.predatesEncryption).toBe(true)
  })
  it.each(['Basic flr_test', 'Bearerflr_test', 'Bearer', 'Bearer\tflr_test'])(
    'does not treat the malformed or unrelated header %s as bearer authentication',
    async (authorization) => {
      expect(
        await getAuthenticatedUser(request('/api/files', 'POST', authorization))
      ).toBeNull()
      expect(mocks.token).not.toHaveBeenCalled()
      expect(mocks.user).not.toHaveBeenCalled()
    }
  )
})
