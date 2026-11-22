import {
  POST as emailAction,
  GET as emailStatus,
} from '@/app/api/users/[id]/email/route'
import { POST as readUser } from '@/app/api/users/[id]/login/route'
import { GET, POST, PUT } from '@/app/api/users/route'
import type { User } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { limitEmailRequestBy } from '@/lib/email/rate-limit'
import { DEFAULT_EMAIL_CONFIG, type EmailConfig } from '@/lib/email/schema'
import { userEmailAction } from '@/lib/email/user-actions'
import { assertPermission } from '@/lib/http/access'
import { ADMIN_PERMISSIONS } from '@/lib/permissions/admin-actions'
import {
  createUser,
  findUserSummary,
  listUsers,
  updateUser,
  userListQuery,
  userUpdatePermission,
} from '@/lib/users/admin'

// Pins what the user administration routes do, so moving their logic into
// lib/ for MCP tools can be checked against the same requests.

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getEmailConfig: vi.fn(),
  getEmailConfigForUpdate: vi.fn(),
  lockEmailUser: vi.fn(),
  sendAccountToken: vi.fn(),
  createAccount: vi.fn(),
  lockRoleChanges: vi.fn(),
  consumeLimit: vi.fn(),
  requireActorPermission: vi.fn(),
  assertCanManageUser: vi.fn(),
  validateRoleAssignment: vi.fn(),
  assertAccessibleAdministrator: vi.fn(),
  db: {
    user: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    role: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  tx: {
    $executeRaw: vi.fn(),
    user: {
      update: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
  },
}))

vi.mock('@/lib/http/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/http/access')>()),
  requireSession: mocks.requireSession,
}))
vi.mock('@/lib/permissions/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permissions/server')>()),
  requireActorPermission: mocks.requireActorPermission,
  assertCanManageUser: mocks.assertCanManageUser,
  validateRoleAssignment: mocks.validateRoleAssignment,
  assertAccessibleAdministrator: mocks.assertAccessibleAdministrator,
  getUserAccess: async () => ({
    roles: [{ id: 'role-everyone', name: 'Everyone' }],
    permissions: [],
  }),
}))
vi.mock('@/lib/database/prisma', () => ({ prisma: mocks.db }))
vi.mock('@/lib/database/locks', () => ({
  lockRoleChanges: mocks.lockRoleChanges,
  lockEmailAddress: vi.fn(),
}))
vi.mock('@/lib/email/config', () => ({
  getEmailConfig: mocks.getEmailConfig,
  getEmailConfigForUpdate: mocks.getEmailConfigForUpdate,
}))
vi.mock('@/lib/email/account', () => ({
  lockEmailUser: mocks.lockEmailUser,
  sendAccountToken: mocks.sendAccountToken,
}))
vi.mock('@/lib/email/tokens', () => ({ invalidateEmailTokens: vi.fn() }))
vi.mock('@/lib/security/database-limit', () => ({
  consumeLimit: mocks.consumeLimit,
}))
vi.mock('@/lib/logger', () => ({ loggers: { users: { error: vi.fn() } } }))
vi.mock('@/lib/storage', () => ({ getStorageProvider: vi.fn() }))
vi.mock('@/lib/users/create-account', () => ({
  createAccount: mocks.createAccount,
}))

const target = {
  id: 'target',
  name: 'Target',
  email: 'target@example.com',
  password: 'hash',
  image: null,
  urlId: 'abc12',
  vanityId: null,
  storageUsed: 0,
  sessionVersion: 1,
  emailVerified: null,
  emailVerifiedFor: null,
  emailVerificationSource: 'pending_local',
  emailExempt: false,
  pendingEmail: null,
  createdAt: new Date('2026-01-01'),
} as unknown as User

const enabled: EmailConfig = {
  ...structuredClone(DEFAULT_EMAIL_CONFIG),
  enabled: true,
}

/** Signs in as an account holding these permissions, checked as the real session check does. */
function signIn(permissions: string[]) {
  const user = { id: 'operator', permissions }
  mocks.requireSession.mockImplementation(async (_request, permission) => {
    if (permission !== undefined) assertPermission(user, permission)
    return { response: null, user }
  })
}

function json(
  body: unknown,
  method: string,
  url = 'https://flare.example/api/users'
) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.9' },
    body: JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ id: target.id }) }

beforeEach(() => {
  vi.resetAllMocks()
  signIn(['administrator'])
  mocks.db.$transaction.mockImplementation(async (callback) =>
    callback(mocks.tx)
  )
  mocks.db.user.findUnique.mockResolvedValue(target)
  mocks.lockEmailUser.mockResolvedValue(target)
  mocks.getEmailConfig.mockResolvedValue(enabled)
  mocks.getEmailConfigForUpdate.mockResolvedValue(enabled)
  mocks.consumeLimit.mockResolvedValue({ allowed: true, resetsIn: 3600 })
  mocks.tx.user.findMany.mockResolvedValue([])
  mocks.tx.user.findUniqueOrThrow.mockResolvedValue({
    roles: [{ id: 'role-a' }],
  })
  mocks.tx.user.update.mockImplementation(async ({ data }) => ({
    ...target,
    ...data,
    roles: [],
    _count: { files: 0, shortenedUrls: 0 },
  }))
  mocks.createAccount.mockImplementation(async (_tx, data) => ({
    ...target,
    id: 'created',
    ...data,
  }))
})

describe('GET /api/users', () => {
  it('filters by a role other than Everyone and lists Everyone last', async () => {
    const everyone = { id: 'role-everyone', name: 'Everyone' }
    mocks.db.role.findUnique.mockResolvedValue(everyone)
    mocks.db.user.count.mockResolvedValue(1)
    mocks.db.user.findMany.mockResolvedValue([
      {
        ...target,
        roles: [everyone, { id: 'role-a', name: 'A' }],
        invite: { creator: { id: 'inviter', name: 'Inviter' } },
        _count: { files: 2, shortenedUrls: 1 },
      },
    ])
    const response = await GET(
      new Request('https://flare.example/api/users?roleId=role-a')
    )
    const body = await response.json()
    expect(mocks.db.user.findMany.mock.calls[0][0].where).toEqual({
      roles: { some: { id: 'role-a' } },
    })
    expect(mocks.db.user.findMany.mock.calls[0][0].orderBy).toEqual({
      createdAt: 'desc',
    })
    expect(body.success).toBe(true)
    expect(body.data[0].roles.map((role: { id: string }) => role.id)).toEqual([
      'role-a',
      'role-everyone',
    ])
    expect(body.data[0].invitedBy).toEqual({ id: 'inviter', name: 'Inviter' })
    expect(body.data[0]).not.toHaveProperty('invite')

    await GET(
      new Request('https://flare.example/api/users?roleId=role-everyone')
    )
    expect(mocks.db.user.findMany.mock.calls[1][0].where).toEqual({})
  })

  it('needs users.read', async () => {
    signIn(['users.create'])
    expect(
      (await GET(new Request('https://flare.example/api/users'))).status
    ).toBe(403)
    expect(mocks.db.user.count).not.toHaveBeenCalled()
  })

  it('cuts the search to 200 characters after trimming', async () => {
    mocks.db.user.count.mockResolvedValue(0)
    mocks.db.user.findMany.mockResolvedValue([])
    await GET(
      new Request(
        `https://flare.example/api/users?search=%20${'a'.repeat(250)}`
      )
    )
    expect(
      mocks.db.user.findMany.mock.calls[0][0].where.OR[0].name.contains
    ).toBe('a'.repeat(200))
  })
})

describe('POST /api/users', () => {
  const created = { name: 'New person', email: 'new@example.com' }

  it('needs users.create', async () => {
    signIn(['users.update', 'users.roles'])
    mocks.db.user.findUnique.mockResolvedValue(null)
    expect((await POST(json(created, 'POST'))).status).toBe(403)
    expect(mocks.createAccount).not.toHaveBeenCalled()
  })

  it('refuses a body that is not an object', async () => {
    const response = await POST(json([created], 'POST'))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Provide a JSON object',
    })
  })

  it('refuses an address an account already uses before any transaction', async () => {
    const response = await POST(json(created, 'POST'))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      success: false,
      error: 'User already exists',
    })
    expect(mocks.db.$transaction).not.toHaveBeenCalled()
  })

  it('creates an account with no password when none is sent', async () => {
    mocks.db.user.findUnique.mockResolvedValue(null)
    const response = await POST(json(created, 'POST'))
    expect(response.status).toBe(200)
    const [tx, account, email] = mocks.createAccount.mock.calls[0]
    expect(tx).toBe(mocks.tx)
    expect(account).toEqual({
      email: created.email,
      name: created.name,
      password: undefined,
      roleIds: undefined,
      emailExempt: false,
    })
    expect(email).toEqual({ verifyWith: enabled })
    expect(mocks.requireActorPermission.mock.calls).toEqual([
      [mocks.tx, 'operator', 'users.create'],
    ])
    expect(mocks.validateRoleAssignment).not.toHaveBeenCalled()
    expect(mocks.lockRoleChanges.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.requireActorPermission.mock.invocationCallOrder[0]
    )
    expect(await response.json()).toEqual({
      success: true,
      data: {
        id: 'created',
        name: created.name,
        email: created.email,
        image: null,
        roles: [{ id: 'role-everyone', name: 'Everyone' }],
        urlId: target.urlId,
        vanityId: null,
        storageUsed: 0,
        _count: { files: 0, shortenedUrls: 0 },
      },
    })
  })

  it('stores a hash of a sent password and checks role assignment under the lock', async () => {
    mocks.db.user.findUnique.mockResolvedValue(null)
    mocks.getEmailConfigForUpdate.mockResolvedValue({
      ...enabled,
      verification: { ...enabled.verification, adminCreated: 'exempt' },
    })
    const response = await POST(
      json(
        { ...created, password: 'a-good-password', roleIds: ['role-a'] },
        'POST'
      )
    )
    expect(response.status).toBe(200)
    const account = mocks.createAccount.mock.calls[0][1]
    expect(account.password).toMatch(/^\$2[aby]\$10\$/)
    expect(account.roleIds).toEqual(['role-a'])
    expect(account.emailExempt).toBe(true)
    expect(mocks.requireActorPermission.mock.calls).toEqual([
      [mocks.tx, 'operator', 'users.create'],
      [mocks.tx, 'operator', 'users.roles'],
    ])
    expect(mocks.validateRoleAssignment).toHaveBeenCalledWith(
      mocks.tx,
      'operator',
      null,
      ['role-a']
    )
  })
})

describe('PUT /api/users', () => {
  it('needs only users.roles for a change of roles alone', async () => {
    signIn(['users.roles'])
    const response = await PUT(
      json({ id: target.id, roleIds: ['role-b'] }, 'PUT')
    )
    expect(response.status).toBe(200)
    expect(mocks.requireActorPermission.mock.calls).toEqual([
      [mocks.tx, 'operator', 'users.roles'],
      [mocks.tx, 'operator', 'users.roles'],
    ])
    expect(mocks.assertCanManageUser).toHaveBeenCalledWith(
      mocks.tx,
      'operator',
      target.id
    )
    expect(mocks.validateRoleAssignment).toHaveBeenCalledWith(
      mocks.tx,
      'operator',
      target.id,
      ['role-b']
    )
    const data = mocks.tx.user.update.mock.calls[0][0].data
    expect(data.roles).toEqual({ set: [{ id: 'role-b' }] })
    expect(data).not.toHaveProperty('name')
    expect(mocks.assertAccessibleAdministrator).toHaveBeenCalledWith(
      mocks.tx,
      enabled
    )
    expect((await response.json()).data.roles).toEqual([
      { id: 'role-everyone', name: 'Everyone' },
    ])
  })

  it('needs users.update for any other field, checked before the body is validated', async () => {
    signIn(['users.roles'])
    for (const body of [
      { id: target.id, name: 'Renamed' },
      { id: target.id, unknown: true },
    ]) {
      const response = await PUT(json(body, 'PUT'))
      expect(response.status).toBe(403)
    }
    expect(mocks.db.user.findUnique).not.toHaveBeenCalled()
  })

  it('checks users.update under the lock for an identity change', async () => {
    const response = await PUT(json({ id: target.id, name: 'Renamed' }, 'PUT'))
    expect(response.status).toBe(200)
    expect(mocks.requireActorPermission.mock.calls).toEqual([
      [mocks.tx, 'operator', 'users.update'],
    ])
    expect(mocks.tx.user.update.mock.calls[0][0].data).toMatchObject({
      name: 'Renamed',
    })
  })

  it('leaves unchanged roles alone without checking role assignment', async () => {
    const response = await PUT(
      json({ id: target.id, name: 'Renamed', roleIds: ['role-a'] }, 'PUT')
    )
    expect(response.status).toBe(200)
    expect(mocks.validateRoleAssignment).not.toHaveBeenCalled()
    expect(mocks.tx.user.update.mock.calls[0][0].data).not.toHaveProperty(
      'roles'
    )
  })

  it('needs an id and an account that exists', async () => {
    const missingId = await PUT(json({ name: 'Renamed' }, 'PUT'))
    expect(missingId.status).toBe(400)
    expect(await missingId.json()).toEqual({
      success: false,
      error: 'User ID is required',
    })
    mocks.db.user.findUnique.mockResolvedValue(null)
    const missing = await PUT(json({ id: 'nobody', name: 'Renamed' }, 'PUT'))
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({
      success: false,
      error: 'User not found',
    })
    expect(mocks.db.$transaction).not.toHaveBeenCalled()
  })
})

describe('POST /api/users/[id]/login', () => {
  const url = `https://flare.example/api/users/${target.id}/login`

  it('answers one account by id', async () => {
    const summary = {
      id: target.id,
      name: target.name,
      email: target.email,
      image: null,
      roles: [],
    }
    mocks.db.user.findUnique.mockResolvedValue(summary)
    const response = await readUser(
      new Request(url, { method: 'POST' }),
      params
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(summary)
    expect(mocks.db.user.findUnique).toHaveBeenCalledWith({
      where: { id: target.id },
      select: { id: true, name: true, email: true, image: true, roles: true },
    })
  })

  it('needs users.read and answers 404 for an unknown account', async () => {
    signIn(['users.update'])
    expect(
      (await readUser(new Request(url, { method: 'POST' }), params)).status
    ).toBe(403)
    signIn(['users.read'])
    mocks.db.user.findUnique.mockResolvedValue(null)
    const response = await readUser(
      new Request(url, { method: 'POST' }),
      params
    )
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'User not found' })
  })
})

describe('/api/users/[id]/email', () => {
  const url = `https://flare.example/api/users/${target.id}/email`
  const limited = () =>
    mocks.consumeLimit.mock.calls.map(([table, key, limit, seconds]) => [
      table,
      key,
      limit,
      seconds,
    ])

  it('answers the account email status, or 404', async () => {
    const response = await emailStatus(new Request(url), params)
    expect(await response.json()).toEqual({
      verified: false,
      exempt: false,
      required: false,
      pendingEmail: null,
      canResend: true,
    })
    mocks.db.user.findUnique.mockResolvedValue(null)
    const missing = await emailStatus(new Request(url), params)
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'Account not found.' })
  })

  it('needs users.email', async () => {
    signIn(['users.update'])
    expect((await emailStatus(new Request(url), params)).status).toBe(403)
    expect(
      (await emailAction(json({ action: 'exempt' }, 'POST', url), params))
        .status
    ).toBe(403)
    expect(mocks.consumeLimit).not.toHaveBeenCalled()
  })

  it('refuses an unknown action and disabled email before counting a request', async () => {
    expect(
      (await emailAction(json({ action: 'delete' }, 'POST', url), params))
        .status
    ).toBe(400)
    mocks.getEmailConfig.mockResolvedValue(DEFAULT_EMAIL_CONFIG)
    const disabled = await emailAction(
      json({ action: 'exempt' }, 'POST', url),
      params
    )
    expect(disabled.status).toBe(400)
    expect(await disabled.json()).toEqual({ error: 'Email is disabled.' })
    expect(mocks.consumeLimit).not.toHaveBeenCalled()
  })

  it.each([
    ['exempt', true],
    ['require', false],
  ] as const)(
    'saves %s under the role lock, counted by client address',
    async (action, exempt) => {
      const response = await emailAction(json({ action }, 'POST', url), params)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        message: 'Email verification exemption updated.',
      })
      expect(limited()).toEqual([
        [
          'EmailRateLimit',
          'email:ip:203.0.113.9',
          enabled.limits.ipPerHour,
          3600,
        ],
      ])
      expect(mocks.tx.user.update).toHaveBeenCalledWith({
        where: { id: target.id },
        data: { emailExempt: exempt },
      })
      expect(mocks.requireActorPermission).toHaveBeenCalledWith(
        mocks.tx,
        'operator',
        'users.email'
      )
      expect(mocks.assertCanManageUser).toHaveBeenCalledWith(
        mocks.tx,
        'operator',
        target.id
      )
      expect(mocks.assertAccessibleAdministrator).toHaveBeenCalledWith(
        mocks.tx,
        enabled
      )
      const order = [
        mocks.consumeLimit,
        mocks.lockRoleChanges,
        mocks.getEmailConfigForUpdate,
        mocks.requireActorPermission,
        mocks.assertCanManageUser,
        mocks.lockEmailUser,
        mocks.tx.user.update,
        mocks.assertAccessibleAdministrator,
      ].map((mock) => mock.mock.invocationCallOrder[0])
      expect(order).toEqual([...order].sort((a, b) => a - b))
    }
  )

  it('resends a verification link, counted by address and then by recipient', async () => {
    const response = await emailAction(
      json({ action: 'resend' }, 'POST', url),
      params
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      message: 'Verification email queued.',
    })
    expect(limited()).toEqual([
      [
        'EmailRateLimit',
        'email:ip:203.0.113.9',
        enabled.limits.ipPerHour,
        3600,
      ],
      [
        'EmailRateLimit',
        'email:ip:203.0.113.9',
        enabled.limits.ipPerHour,
        3600,
      ],
      [
        'EmailRateLimit',
        'email:address:target@example.com',
        enabled.limits.addressPerHour,
        3600,
      ],
      [
        'EmailRateLimit',
        'email:cooldown:target@example.com',
        1,
        enabled.limits.resendSeconds,
      ],
    ])
    expect(mocks.sendAccountToken).toHaveBeenCalledWith(
      mocks.tx,
      target,
      'verify',
      enabled
    )
    expect(mocks.tx.user.update).not.toHaveBeenCalled()
    expect(mocks.assertAccessibleAdministrator).not.toHaveBeenCalled()
  })

  it('refuses a resend for an account that did not enroll its address', async () => {
    mocks.lockEmailUser.mockResolvedValue({
      ...target,
      emailVerificationSource: null,
    })
    const response = await emailAction(
      json({ action: 'resend' }, 'POST', url),
      params
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error:
        'This user must enroll their recovery address from their own profile.',
    })
    expect(limited()).toHaveLength(1)
    expect(mocks.sendAccountToken).not.toHaveBeenCalled()
  })

  it('answers 429 when the client address is over its limit', async () => {
    mocks.consumeLimit.mockResolvedValue({ allowed: false, resetsIn: 120 })
    const response = await emailAction(
      json({ action: 'exempt' }, 'POST', url),
      params
    )
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('120')
    expect(mocks.db.$transaction).not.toHaveBeenCalled()
  })

  it('rechecks that email is enabled under the lock', async () => {
    mocks.getEmailConfigForUpdate.mockResolvedValue(DEFAULT_EMAIL_CONFIG)
    const response = await emailAction(
      json({ action: 'exempt' }, 'POST', url),
      params
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Email is disabled.' })
    expect(mocks.requireActorPermission).not.toHaveBeenCalled()
  })
})

// What the routes can't send: an MCP tool calls these directly, with no
// password, no email and no client address.
describe('user administration for other callers', () => {
  it('lists the routes’ gates in a module with no server imports', async () => {
    const { readFile } = await import('node:fs/promises')
    const source = await readFile('lib/permissions/admin-actions.ts', 'utf8')
    expect([...source.matchAll(/from '([^']+)'/g)].map((m) => m[1])).toEqual([
      './catalog',
    ])
    expect(ADMIN_PERMISSIONS).toMatchObject({
      listUsers: ['users.read'],
      getUser: ['users.read'],
      createUser: ['users.create'],
      updateUser: ['users.update'],
      assignUserRoles: ['users.roles'],
      manageUserEmail: ['users.email'],
    })
  })

  it('reads a directory query from a URL and applies its defaults', async () => {
    expect(userListQuery(new URLSearchParams('search=a&page=2'))).toEqual({
      search: 'a',
      roleId: null,
      page: 2,
      limit: 0,
    })
    mocks.db.user.count.mockResolvedValue(30)
    mocks.db.user.findMany.mockResolvedValue([])
    const { pagination } = await listUsers({})
    expect(pagination).toEqual({ total: 30, pageCount: 2, page: 1, limit: 25 })
    expect(mocks.db.user.findMany.mock.calls[0][0].where).toEqual({})
  })

  it('looks one account up by email as well as by id', async () => {
    mocks.db.user.findUnique.mockResolvedValue(null)
    expect(await findUserSummary({ email: 'target@example.com' })).toBeNull()
    expect(mocks.db.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'target@example.com' },
      select: { id: true, name: true, email: true, image: true, roles: true },
    })
  })

  it('creates an account with no password', async () => {
    mocks.db.user.findUnique.mockResolvedValue(null)
    const user = await createUser('operator', {
      name: 'No password',
      email: 'none@example.com',
    })
    expect(mocks.createAccount.mock.calls[0][1].password).toBeUndefined()
    expect(user).toMatchObject({ id: 'created', email: 'none@example.com' })
  })

  it('chooses the permission by the fields an edit names', () => {
    expect(userUpdatePermission([])).toBe('users.roles')
    expect(userUpdatePermission(['id', 'roleIds'])).toBe('users.roles')
    expect(userUpdatePermission(['id', 'vanityId'])).toBe('users.update')
  })

  it('changes only the roles, counting fields left undefined as absent', async () => {
    await updateUser('operator', {
      id: target.id,
      name: undefined,
      email: undefined,
      roleIds: ['role-b'],
    })
    expect(mocks.requireActorPermission.mock.calls[0]).toEqual([
      mocks.tx,
      'operator',
      'users.roles',
    ])
    const data = mocks.tx.user.update.mock.calls[0][0].data
    expect(data.roles).toEqual({ set: [{ id: 'role-b' }] })
    expect(data).not.toHaveProperty('email')
    expect(data).not.toHaveProperty('password')
    expect(data).not.toHaveProperty('sessionVersion')
  })

  it('renames an account without touching its email or password', async () => {
    await updateUser('operator', { id: target.id, name: 'Renamed' })
    expect(mocks.requireActorPermission.mock.calls).toEqual([
      [mocks.tx, 'operator', 'users.update'],
    ])
    const data = mocks.tx.user.update.mock.calls[0][0].data
    expect(data).toMatchObject({ name: 'Renamed' })
    expect(data).not.toHaveProperty('email')
    expect(data).not.toHaveProperty('password')
    expect(data).not.toHaveProperty('roles')
  })

  it('keys the email limits by an account instead of a client address', async () => {
    await userEmailAction(
      'operator',
      target.id,
      'resend',
      (config, recipient) =>
        limitEmailRequestBy('account:operator', config, recipient)
    )
    expect(mocks.consumeLimit.mock.calls.map((call) => call[1])).toEqual([
      'email:account:operator',
      'email:account:operator',
      'email:address:target@example.com',
      'email:cooldown:target@example.com',
    ])
  })
})
