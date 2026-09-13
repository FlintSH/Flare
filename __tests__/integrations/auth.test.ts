import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getAuthenticatedUser } from '@/lib/auth/api-auth'
import { hashApiToken } from '@/lib/integrations/tokens'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  token: vi.fn(),
  user: vi.fn(),
  update: vi.fn(),
  policy: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getAccessSession: mocks.session }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    apiToken: { findUnique: mocks.token, update: mocks.update },
    user: { findUnique: mocks.user },
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
  revokedAt: null,
  expiresAt: null,
  user: {
    id: 'user-1',
    storageUsed: 0,
    urlId: 'u',
    vanityId: null,
    role: 'USER',
    randomizeFileUrls: true,
    password: 'never-return',
  },
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.token.mockResolvedValue(token)
  mocks.update.mockResolvedValue({})
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
    })
    expect(user).not.toHaveProperty('password')
    expect(mocks.user).not.toHaveBeenCalled()
  })
  it.each(['Bearer', 'bearer', 'BEARER', 'bEaReR', 'Bearer  '])(
    'accepts the %s scheme without changing the named token value',
    async (scheme) => {
      const user = await getAuthenticatedUser(
        request('/api/files', 'POST', `${scheme} flr_MixedCaseToken`)
      )
      expect(user?.id).toBe('user-1')
      expect(mocks.token).toHaveBeenCalledWith({
        where: { hash: hashApiToken('flr_MixedCaseToken') },
        include: { user: true },
      })
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
      mocks.user.mockResolvedValue(token.user)
      const result = await getAuthenticatedUser(
        request('/api/files', 'POST', `${scheme} legacy-MixedCaseToken`)
      )
      expect(result?.id).toBe('user-1')
      expect(mocks.user).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { uploadToken: 'legacy-MixedCaseToken' },
        })
      )
      expect(mocks.token).not.toHaveBeenCalled()
    }
  )
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
