import { POST, PUT } from '@/app/api/users/route'
import type { User } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_EMAIL_CONFIG } from '@/lib/email/schema'

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getEmailConfig: vi.fn(),
  getEmailConfigForUpdate: vi.fn(),
  lockEmailUser: vi.fn(),
  lockEmailAddress: vi.fn(),
  sendAccountToken: vi.fn(),
  createUser: vi.fn(),
  invalidateEmailTokens: vi.fn(),
  db: {
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  tx: {
    $executeRaw: vi.fn(),
    user: { update: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  },
}))

vi.mock('@/lib/auth/api-auth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/database/prisma', () => ({ prisma: mocks.db }))
vi.mock('@/lib/email/config', () => ({
  getEmailConfig: mocks.getEmailConfig,
  getEmailConfigForUpdate: mocks.getEmailConfigForUpdate,
}))
vi.mock('@/lib/email/account', () => ({
  lockEmailUser: mocks.lockEmailUser,
  lockEmailAddress: mocks.lockEmailAddress,
  sendAccountToken: mocks.sendAccountToken,
}))
vi.mock('@/lib/email/tokens', () => ({
  invalidateEmailTokens: mocks.invalidateEmailTokens,
}))
vi.mock('@/lib/logger', () => ({ loggers: { users: { error: vi.fn() } } }))
vi.mock('@/lib/storage', () => ({ getStorageProvider: vi.fn() }))
vi.mock('@/lib/users/create-user', () => ({ createUser: mocks.createUser }))

const initial: User = {
  id: 'target',
  name: 'Original name',
  email: 'old@example.com',
  role: 'USER',
  password: 'original-password-hash',
  emailVerified: new Date('2026-01-01'),
  emailVerifiedFor: 'old@example.com',
  emailVerificationSource: 'email',
  emailExempt: false,
  pendingEmail: null,
  pendingEmailOldConfirmed: false,
  image: null,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2026-01-01'),
  storageUsed: 0,
  sessionVersion: 1,
  oidcSubject: null,
  vanityId: null,
  urlId: 'abc12',
  uploadToken: 'upload-token',
  randomizeFileUrls: false,
  defaultFileExpiration: 'DISABLED',
  defaultFileExpirationAction: 'DELETE',
}

function request(changes: Record<string, unknown> = {}, method = 'PUT') {
  return new Request('https://flare.example/api/users', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: initial.id,
      name: 'Edited name',
      email: initial.email,
      role: initial.role,
      ...changes,
    }),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireAdmin.mockResolvedValue({
    response: null,
    user: { id: 'operator', role: 'ADMIN' },
  })
  mocks.db.user.findUnique.mockResolvedValue(initial)
  mocks.db.$transaction.mockImplementation(async (callback) =>
    callback(mocks.tx)
  )
  mocks.lockEmailUser.mockResolvedValue(initial)
  mocks.getEmailConfig.mockResolvedValue(structuredClone(DEFAULT_EMAIL_CONFIG))
  mocks.getEmailConfigForUpdate.mockResolvedValue({
    ...structuredClone(DEFAULT_EMAIL_CONFIG),
    enabled: true,
  })
  mocks.tx.user.findFirst.mockResolvedValue(null)
  mocks.tx.user.findMany.mockResolvedValue([])
  mocks.createUser.mockImplementation(async (_tx, data) => ({
    ...initial,
    ...data,
  }))
  mocks.tx.user.update.mockImplementation(async ({ data }) => ({
    ...initial,
    ...data,
    _count: { files: 0, shortenedUrls: 0 },
  }))
})

describe('administrator account update serialization', () => {
  it('uses the policy enabled before account creation for verification and exemptions', async () => {
    mocks.db.user.findUnique.mockResolvedValue(null)
    const currentConfig = {
      ...structuredClone(DEFAULT_EMAIL_CONFIG),
      enabled: true,
      verification: {
        ...DEFAULT_EMAIL_CONFIG.verification,
        mode: 'new_users',
        adminCreated: 'inherit',
      },
    }
    mocks.getEmailConfigForUpdate.mockResolvedValue(currentConfig)
    const response = await POST(request({}, 'POST'))
    expect(response.status).toBe(200)
    expect(
      mocks.getEmailConfigForUpdate.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.lockEmailAddress.mock.invocationCallOrder[0])
    expect(mocks.createUser).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        emailExempt: false,
        emailVerificationSource: 'pending_local',
      })
    )
    expect(mocks.sendAccountToken).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({ email: initial.email }),
      'verify',
      currentConfig
    )
  })
  it('preserves a concurrently verified address and its proof during an unrelated name edit', async () => {
    const verified = {
      ...initial,
      email: 'verified@example.com',
      emailVerifiedFor: 'verified@example.com',
      sessionVersion: 2,
    }
    mocks.lockEmailUser.mockResolvedValue(verified)
    mocks.tx.user.update.mockImplementation(async ({ data }) => ({
      ...verified,
      ...data,
      _count: { files: 0, shortenedUrls: 0 },
    }))

    const response = await PUT(request())
    expect(response.status).toBe(200)
    const saved = mocks.tx.user.update.mock.calls[0][0].data
    expect(saved).toMatchObject({ name: 'Edited name' })
    expect(saved).not.toHaveProperty('email')
    expect(saved).not.toHaveProperty('emailVerifiedFor')
    expect(saved).not.toHaveProperty('sessionVersion')
    expect(mocks.invalidateEmailTokens).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({
      data: { email: verified.email },
    })
  })

  it('rejects a requested address change when the identity changed after the initial read', async () => {
    mocks.lockEmailUser.mockResolvedValue({
      ...initial,
      email: 'concurrent@example.com',
    })
    const response = await PUT(request({ email: 'requested@example.com' }))
    expect(response.status).toBe(400)
    expect(mocks.tx.user.update).not.toHaveBeenCalled()
    expect(mocks.invalidateEmailTokens).not.toHaveBeenCalled()
  })

  it('uses the policy read under the config lock for session invalidation after email is enabled', async () => {
    const response = await PUT(request({ email: 'requested@example.com' }))
    expect(response.status).toBe(200)
    expect(mocks.getEmailConfigForUpdate).toHaveBeenCalledWith(mocks.tx)
    expect(
      mocks.getEmailConfigForUpdate.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.lockEmailUser.mock.invocationCallOrder[0])
    expect(mocks.tx.user.update.mock.calls[0][0].data).toMatchObject({
      email: 'requested@example.com',
      emailVerified: null,
      emailVerifiedFor: null,
      emailVerificationSource: null,
      pendingEmail: null,
      pendingEmailOldConfirmed: false,
      sessionVersion: { increment: 1 },
    })
    expect(mocks.invalidateEmailTokens).toHaveBeenCalledWith(
      mocks.tx,
      initial.id
    )
    expect(mocks.lockEmailAddress).toHaveBeenCalledWith(
      mocks.tx,
      'requested@example.com'
    )
  })

  it('uses the newly enabled policy when checking case-insensitive mailbox conflicts', async () => {
    mocks.tx.user.findFirst.mockResolvedValue({
      id: 'another-account',
      email: 'REQUESTED@example.com',
    })
    const response = await PUT(request({ email: 'requested@example.com' }))
    expect(response.status).toBe(400)
    expect(mocks.tx.user.findFirst).toHaveBeenCalledWith({
      where: {
        id: { not: initial.id },
        email: { equals: 'requested@example.com', mode: 'insensitive' },
      },
    })
    expect(mocks.tx.user.update).not.toHaveBeenCalled()
  })

  it('preserves a concurrent role change when the submitted role was unchanged', async () => {
    mocks.lockEmailUser.mockResolvedValue({ ...initial, role: 'ADMIN' })
    const response = await PUT(request())
    expect(response.status).toBe(200)
    expect(mocks.tx.user.update.mock.calls[0][0].data).not.toHaveProperty(
      'role'
    )
  })

  it('preserves disabled-instance password behavior using the locked policy', async () => {
    mocks.getEmailConfigForUpdate.mockResolvedValue(
      structuredClone(DEFAULT_EMAIL_CONFIG)
    )
    const response = await PUT(request({ password: 'a'.repeat(73) }))
    expect(response.status).toBe(200)
    expect(mocks.tx.user.update.mock.calls[0][0].data).not.toHaveProperty(
      'sessionVersion'
    )
  })

  it('enforces the enabled-instance password limit after the policy changes', async () => {
    const response = await PUT(request({ password: 'a'.repeat(73) }))
    expect(response.status).toBe(400)
    expect(mocks.tx.user.update).not.toHaveBeenCalled()
  })
})
