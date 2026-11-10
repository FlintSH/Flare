import { GET, POST, PUT } from '@/app/api/users/route'
import type { User } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MailLimitError } from '@/lib/email/outbox'
import { DEFAULT_EMAIL_CONFIG } from '@/lib/email/schema'
import { AccessError } from '@/lib/http/errors'

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  getEmailConfig: vi.fn(),
  getEmailConfigForUpdate: vi.fn(),
  lockEmailUser: vi.fn(),
  lockEmailAddress: vi.fn(),
  sendAccountToken: vi.fn(),
  createAccount: vi.fn(),
  invalidateEmailTokens: vi.fn(),
  db: {
    user: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    role: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  tx: {
    $executeRaw: vi.fn(),
    user: { update: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    authChallenge: { deleteMany: vi.fn() },
  },
}))

vi.mock('@/lib/http/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/http/access')>()),
  requireSession: mocks.requirePermission,
}))
vi.mock('@/lib/permissions/server', () => ({
  requireActorPermission: vi.fn(),
  assertCanManageUser: vi.fn(),
  validateRoleAssignment: vi.fn(),
  assertAccessibleAdministrator: vi.fn(),
  getUserAccess: async () => ({ roles: [], permissions: [] }),
}))
vi.mock('@/lib/database/prisma', () => ({ prisma: mocks.db }))
vi.mock('@/lib/database/locks', () => ({
  lockRoleChanges: vi.fn(),
  lockEmailAddress: mocks.lockEmailAddress,
}))
vi.mock('@/lib/email/config', () => ({
  getEmailConfig: mocks.getEmailConfig,
  getEmailConfigForUpdate: mocks.getEmailConfigForUpdate,
}))
vi.mock('@/lib/email/account', () => ({
  lockEmailUser: mocks.lockEmailUser,
  sendAccountToken: mocks.sendAccountToken,
}))
vi.mock('@/lib/email/tokens', () => ({
  invalidateEmailTokens: mocks.invalidateEmailTokens,
}))
vi.mock('@/lib/logger', () => ({ loggers: { users: { error: vi.fn() } } }))
vi.mock('@/lib/storage', () => ({ getStorageProvider: vi.fn() }))
vi.mock('@/lib/users/create-account', () => ({
  createAccount: mocks.createAccount,
}))

const initial: User = {
  uploadTokenHash: null,
  uploadTokenUsedAt: null,
  passkeyRequired: false,
  totpSecret: null,
  totpLastCounter: null,
  id: 'target',
  name: 'Original name',
  email: 'old@example.com',
  password: 'original-password-hash',
  accountPublicKey: null,
  passphraseSalt: null,
  authPublicKey: null,
  wrappedRoot: null,
  sealedKeyring: null,
  e2eeProtocolVersion: null,
  emailVerified: new Date('2026-01-01'),
  emailVerifiedFor: 'old@example.com',
  emailVerificationSource: 'email',
  emailExempt: false,
  pendingEmail: null,
  pendingEmailOldConfirmed: false,
  image: null,
  avatarStoragePath: null,
  avatarStorageTarget: null,
  inviteId: null,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2026-01-01'),
  storageUsed: 0,
  sessionVersion: 1,
  oidcSubject: null,
  vanityId: null,
  urlId: 'abc12',
  randomizeFileUrls: false,
  defaultFileExpiration: 'DISABLED',
  defaultFileExpirationAction: 'DELETE',
  preferences: {},
  defaultUploadProfileId: null,
}

function request(changes: Record<string, unknown> = {}, method = 'PUT') {
  return new Request('https://flare.example/api/users', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: initial.id,
      name: 'Edited name',
      email: initial.email,
      ...changes,
    }),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requirePermission.mockResolvedValue({
    response: null,
    user: { id: 'operator', permissions: ['administrator'] },
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
  mocks.createAccount.mockImplementation(async (_tx, data) => ({
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
    // createAccount decides on the verification link from these settings.
    expect(mocks.createAccount).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({ email: initial.email, emailExempt: false }),
      { verifyWith: currentConfig }
    )
  })

  it('refuses an address another account already uses', async () => {
    mocks.db.user.findUnique.mockResolvedValue(null)
    mocks.createAccount.mockResolvedValue(null)
    const response = await POST(request({}, 'POST'))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Email already exists',
    })
  })

  it('answers a full daily mail cap with its own message', async () => {
    mocks.db.user.findUnique.mockResolvedValue(null)
    mocks.createAccount.mockRejectedValue(new MailLimitError())
    const response = await POST(request({}, 'POST'))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      success: false,
      error:
        'The daily email sending limit has been reached. Try again tomorrow or contact your administrator.',
    })
  })

  it.each([false, true])(
    'refuses a new password over 72 bytes (email enabled: %s)',
    async (enabled) => {
      mocks.getEmailConfigForUpdate.mockResolvedValue({
        ...structuredClone(DEFAULT_EMAIL_CONFIG),
        enabled,
      })
      for (const response of [
        await POST(request({ password: '🔒'.repeat(19) }, 'POST')),
        await PUT(request({ password: 'a'.repeat(73) })),
      ]) {
        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
          success: false,
          error: 'Password must use at most 72 bytes.',
        })
      }
      expect(mocks.createAccount).not.toHaveBeenCalled()
      expect(mocks.tx.user.update).not.toHaveBeenCalled()
    }
  )
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
    // One update, so the change records one audit event.
    expect(mocks.tx.user.update).toHaveBeenCalledOnce()
    expect(mocks.tx.user.update.mock.calls[0][0].data).toMatchObject({
      name: 'Edited name',
      email: 'requested@example.com',
      emailVerified: null,
      emailVerifiedFor: null,
      emailVerificationSource: null,
      pendingEmail: null,
      pendingEmailOldConfirmed: false,
      sessionVersion: { increment: 1 },
    })
    expect(mocks.tx.authChallenge.deleteMany).toHaveBeenCalledWith({
      where: { userId: initial.id },
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
    mocks.tx.user.findFirst.mockResolvedValue({ id: 'another-account' })
    const response = await PUT(request({ email: 'requested@example.com' }))
    expect(response.status).toBe(400)
    expect(mocks.tx.user.findFirst).toHaveBeenCalledWith({
      where: {
        id: { not: initial.id },
        email: { equals: 'requested@example.com', mode: 'insensitive' },
      },
      select: { id: true },
    })
    expect(mocks.tx.user.update).not.toHaveBeenCalled()
  })

  // Without account email, addresses are unique only as written, which the
  // database enforces too: the duplicate was a server error before.
  it('refuses an address another account uses as written while email is disabled', async () => {
    mocks.getEmailConfigForUpdate.mockResolvedValue(
      structuredClone(DEFAULT_EMAIL_CONFIG)
    )
    mocks.tx.user.findFirst.mockResolvedValue({ id: 'another-account' })
    const response = await PUT(request({ email: 'Requested@example.com' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Email already exists',
    })
    expect(mocks.lockEmailAddress).toHaveBeenCalledWith(
      mocks.tx,
      'Requested@example.com'
    )
    expect(mocks.tx.user.findFirst).toHaveBeenCalledWith({
      where: { id: { not: initial.id }, email: 'Requested@example.com' },
      select: { id: true },
    })
    expect(mocks.tx.user.update).not.toHaveBeenCalled()
  })

  it('matches an address with an underscore literally, not as a wildcard', async () => {
    const response = await PUT(request({ email: 'requested_x@example.com' }))
    expect(response.status).toBe(200)
    expect(mocks.tx.user.findFirst).toHaveBeenCalledWith({
      where: {
        id: { not: initial.id },
        email: { equals: 'requested\\_x@example.com', mode: 'insensitive' },
      },
      select: { id: true },
    })
  })

  it('preserves assigned roles when an identity update omits roleIds', async () => {
    mocks.lockEmailUser.mockResolvedValue({
      ...initial,
      roles: [{ id: 'concurrent-role' }],
    })
    const response = await PUT(request())
    expect(response.status).toBe(200)
    expect(mocks.tx.user.update.mock.calls[0][0].data).not.toHaveProperty(
      'roles'
    )
  })

  it('revokes sessions and cancels a pending email change for password changes even when email is disabled', async () => {
    mocks.getEmailConfigForUpdate.mockResolvedValue(
      structuredClone(DEFAULT_EMAIL_CONFIG)
    )
    const response = await PUT(request({ password: 'a-new-password' }))
    expect(response.status).toBe(200)
    expect(mocks.tx.user.update).toHaveBeenCalledOnce()
    const saved = mocks.tx.user.update.mock.calls[0][0].data
    expect(saved).toMatchObject({
      password: expect.any(String),
      pendingEmail: null,
      pendingEmailOldConfirmed: false,
      sessionVersion: { increment: 1 },
    })
    expect(saved).not.toHaveProperty('email')
    expect(saved).not.toHaveProperty('passkeyRequired')
    expect(mocks.invalidateEmailTokens).toHaveBeenCalledWith(
      mocks.tx,
      initial.id
    )
  })
})

describe('optional administrator vanity URLs', () => {
  it.each([
    { existingVanity: null, submittedVanity: '' },
    { existingVanity: 'custom-url', submittedVanity: '' },
    { existingVanity: 'custom-url', submittedVanity: null },
  ])(
    'saves an empty vanity URL ($existingVanity → $submittedVanity)',
    async ({ existingVanity, submittedVanity }) => {
      const existingUser = { ...initial, vanityId: existingVanity }
      mocks.db.user.findUnique.mockResolvedValue(existingUser)
      mocks.lockEmailUser.mockResolvedValue(existingUser)

      const response = await PUT(request({ vanityId: submittedVanity }))

      expect(response.status).toBe(200)
      expect(mocks.tx.user.update.mock.calls[0][0].data).toMatchObject({
        name: 'Edited name',
        vanityId: null,
      })
      expect(await response.json()).toMatchObject({
        data: { name: 'Edited name', vanityId: null },
      })
    }
  )

  it('preserves the vanity URL when the field is omitted', async () => {
    const existingUser = { ...initial, vanityId: 'custom-url' }
    mocks.db.user.findUnique.mockResolvedValue(existingUser)
    mocks.lockEmailUser.mockResolvedValue(existingUser)

    const response = await PUT(request())

    expect(response.status).toBe(200)
    expect(mocks.tx.user.update.mock.calls[0][0].data).not.toHaveProperty(
      'vanityId'
    )
  })

  it('saves a valid vanity URL after checking for collisions', async () => {
    mocks.db.user.findUnique.mockImplementation(async ({ where }) =>
      where.id === initial.id ? initial : null
    )

    const response = await PUT(request({ vanityId: 'custom-url' }))

    expect(response.status).toBe(200)
    expect(mocks.tx.user.update.mock.calls[0][0].data.vanityId).toBe(
      'custom-url'
    )
    // Both columns, in the transaction that saves the edit.
    expect(mocks.tx.user.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { urlId: { in: ['custom-url'] } },
          { vanityId: { in: ['custom-url'] } },
        ],
      },
      select: { id: true, urlId: true, vanityId: true },
    })
  })

  it.each(['ab', 'a'.repeat(33), '-custom', 'custom-', 'custom_url', 'API'])(
    'rejects an invalid nonempty vanity URL: %s',
    async (vanityId) => {
      const response = await PUT(request({ vanityId }))

      expect(response.status).toBe(400)
      expect(mocks.tx.user.update).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['vanityId', 'This vanity URL is already taken'],
    ['urlId', 'This vanity URL conflicts with an existing URL ID'],
  ])(
    'rejects a vanity URL that conflicts with another user’s %s',
    async (field, error) => {
      mocks.tx.user.findMany.mockResolvedValue([
        {
          id: 'another-user',
          urlId: 'other',
          vanityId: null,
          [field]: 'custom-url',
        },
      ])

      const response = await PUT(request({ vanityId: 'custom-url' }))

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ success: false, error })
      expect(mocks.tx.user.update).not.toHaveBeenCalled()
    }
  )

  it('rejects a vanity URL that is the account’s own URL ID', async () => {
    const response = await PUT(request({ vanityId: initial.urlId }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      success: false,
      error: 'This vanity URL conflicts with an existing URL ID',
    })
    expect(mocks.tx.user.update).not.toHaveBeenCalled()
  })
})

describe('user directory', () => {
  it('keeps directory search behind the administrator guard', async () => {
    mocks.requirePermission.mockRejectedValue(
      new AccessError(403, 'Permission denied')
    )
    const response = await GET(
      new Request('https://flare.example/api/users?search=person')
    )
    expect(response.status).toBe(403)
    expect(mocks.db.user.findMany).not.toHaveBeenCalled()
    expect(mocks.db.user.count).not.toHaveBeenCalled()
  })

  it('searches the complete directory with matching counts and safe public fields', async () => {
    mocks.db.user.count.mockResolvedValue(26)
    mocks.db.user.findMany.mockResolvedValue([])
    const response = await GET(
      new Request(
        'https://flare.example/api/users?search=%20Jordan%20&role=USER&page=2&limit=25'
      )
    )
    const body = await response.json()
    expect(body.pagination).toEqual({
      total: 26,
      pageCount: 2,
      page: 2,
      limit: 25,
    })
    const query = mocks.db.user.findMany.mock.calls[0][0]
    expect(query.where).toEqual({
      OR: [
        { name: { contains: 'Jordan', mode: 'insensitive' } },
        { email: { contains: 'Jordan', mode: 'insensitive' } },
      ],
    })
    expect(mocks.db.user.count).toHaveBeenCalledWith({ where: query.where })
    expect(query.skip).toBe(25)
    expect(query.take).toBe(25)
    expect(query.select.password).toBeUndefined()
    expect(query.select.uploadTokenHash).toBeUndefined()
  })

  it.each([25, 0])(
    'returns to the first page after the last row on page 2 is removed (total %s)',
    async (total) => {
      mocks.db.user.count.mockResolvedValue(total)
      mocks.db.user.findMany.mockResolvedValue([])
      const response = await GET(
        new Request('https://flare.example/api/users?page=2&limit=25')
      )
      expect(response.status).toBe(200)
      expect((await response.json()).pagination.page).toBe(1)
      expect(mocks.db.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 25 })
      )
    }
  )

  it('bounds an oversized requested page before calculating its database offset', async () => {
    mocks.db.user.count.mockResolvedValue(26)
    mocks.db.user.findMany.mockResolvedValue([])
    const response = await GET(
      new Request(
        'https://flare.example/api/users?page=9007199254740991&limit=25'
      )
    )
    expect(response.status).toBe(200)
    expect((await response.json()).pagination.page).toBe(2)
    expect(mocks.db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 25, take: 25 })
    )
  })

  it.each(['page=NaN&limit=-4', 'page=-2&limit=Infinity'])(
    'recovers malformed pagination: %s',
    async (query) => {
      mocks.db.user.count.mockResolvedValue(0)
      mocks.db.user.findMany.mockResolvedValue([])
      const response = await GET(
        new Request(`https://flare.example/api/users?${query}`)
      )
      expect(response.status).toBe(200)
      expect(mocks.db.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 25 })
      )
    }
  )
})
