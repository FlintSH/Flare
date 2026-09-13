import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getAuthenticatedUser } from '@/lib/auth/api-auth'

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
const request = (path: string, method = 'POST') =>
  new Request(`https://flare.test${path}`, {
    method,
    headers: { authorization: 'Bearer flr_test' },
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
  it('does not upgrade a scoped token to a coexisting administrator session', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'admin' } })
    expect(
      await getAuthenticatedUser(request('/api/profile/upload-token', 'GET'))
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
  it('preserves legacy bearer authentication', async () => {
    mocks.user.mockResolvedValue(token.user)
    const result = await getAuthenticatedUser(
      new Request('https://flare.test/api/files', {
        headers: { authorization: 'Bearer legacy-token' },
      })
    )
    expect(result?.id).toBe('user-1')
    expect(mocks.user).toHaveBeenCalledWith(
      expect.objectContaining({ where: { uploadToken: 'legacy-token' } })
    )
  })
})
