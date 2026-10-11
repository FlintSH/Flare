import { randomBytes, randomUUID } from 'node:crypto'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

const authentication = vi.hoisted(() => ({
  userId: 'admin' as string | null,
}))
// Sessions resolve permissions from the database, matching the real session callback.
vi.mock('@/lib/auth', () => ({
  getAccessSession: async () => {
    if (!authentication.userId) return null
    const { getUserAccess } = await import('@/lib/permissions/server')
    const access = await getUserAccess(authentication.userId)
    return { user: { id: authentication.userId, ...access } }
  },
}))

const databaseUrl = process.env.FLARE_INVITES_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

suite.sequential('invites against disposable PostgreSQL', () => {
  let prisma: typeof import('@/lib/database/prisma').prisma
  let service: typeof import('@/lib/permissions/server')
  let invites: typeof import('@/lib/invites/service')
  let collection: typeof import('@/app/api/invites/route')
  let detail: typeof import('@/app/api/invites/[id]/route')
  let policy: typeof import('@/app/api/settings/invites/route')
  let settings: typeof import('@/app/api/settings/route')
  let register: typeof import('@/app/api/auth/register/route')
  let users: typeof import('@/app/api/users/route')
  let DEFAULT_CONFIG: typeof import('@/lib/config').DEFAULT_CONFIG

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !/^\/flare_invites_test_/.test(url.pathname)
    )
      throw new Error('Use a disposable local flare_invites_test_ database')
    vi.stubEnv('DATABASE_URL', url.toString())
    vi.stubEnv('NEXTAUTH_SECRET', 'invite-tests-only-'.padEnd(48, 'x'))
    vi.stubEnv('FLARE_EMAIL_ENCRYPTION_KEY', '')
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost')
    prisma = (await import('@/lib/database/prisma')).prisma
    DEFAULT_CONFIG = (await import('@/lib/config')).DEFAULT_CONFIG
    service = await import('@/lib/permissions/server')
    invites = await import('@/lib/invites/service')
    collection = await import('@/app/api/invites/route')
    detail = await import('@/app/api/invites/[id]/route')
    policy = await import('@/app/api/settings/invites/route')
    settings = await import('@/app/api/settings/route')
    register = await import('@/app/api/auth/register/route')
    users = await import('@/app/api/users/route')
  })

  beforeEach(async () => {
    await prisma.auditEvent.deleteMany()
    await prisma.invite.deleteMany()
    await prisma.user.deleteMany()
    await prisma.role.deleteMany()
    await prisma.config.deleteMany()
    await prisma.config.create({
      data: {
        key: 'flare_config',
        value: JSON.parse(
          JSON.stringify({
            ...DEFAULT_CONFIG,
            settings: {
              ...DEFAULT_CONFIG.settings,
              general: {
                ...DEFAULT_CONFIG.settings.general,
                setup: { completed: true, completedAt: new Date() },
                registrations: {
                  ...DEFAULT_CONFIG.settings.general.registrations,
                  enabled: false,
                  disabledMessage: 'Private instance',
                },
              },
            },
          })
        ),
      },
    })
    const builtins = await prisma.$transaction(service.ensureBuiltInRoles)
    await account('admin', 'Alex Admin', [builtins.administrator.id])
    await account('member', 'Morgan Member')
    authentication.userId = 'admin'
  })

  afterAll(async () => {
    await prisma?.$disconnect()
    vi.unstubAllEnvs()
  })

  async function account(id: string, name: string, roleIds: string[] = []) {
    return prisma.user.create({
      data: {
        id,
        name,
        email: `${id}@example.test`,
        password: 'fixture-only',
        urlId: id.slice(0, 5).padEnd(5, '0'),
        uploadToken: `${id}-fixture`,
        roles: { connect: roleIds.map((roleId) => ({ id: roleId })) },
      },
    })
  }

  function call(
    url: string,
    method: string,
    body?: unknown,
    headers: Record<string, string> = {}
  ) {
    return new Request(`http://localhost${url}`, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
        // In-memory limiters key by client address; give each call its own.
        'x-forwarded-for': `10.${randomBytes(3).join('.')}`,
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  async function create(body: Record<string, unknown> = {}, as = 'admin') {
    authentication.userId = as
    const response = await collection.POST(
      call('/api/invites', 'POST', {
        maxUses: 1,
        expiresInHours: 24,
        ...body,
      })
    )
    return { response, body: await response.json() }
  }

  async function join(invite: unknown, name: string) {
    const response = await register.POST(
      call('/api/auth/register', 'POST', {
        name,
        email: `${name.toLowerCase().replace(/\W+/g, '.')}@example.test`,
        password: 'Invite-tests-only-2026',
        ...(invite === undefined ? {} : { invite }),
      })
    )
    return {
      status: response.status,
      body: await response.json().catch(() => null),
    }
  }

  async function list(query: string, as = 'admin') {
    authentication.userId = as
    const response = await collection.GET(call(`/api/invites?${query}`, 'GET'))
    return { status: response.status, body: await response.json() }
  }

  async function setEveryone(everyoneCanInvite: boolean, as = 'admin') {
    authentication.userId = as
    const response = await policy.PUT(
      call('/api/settings/invites', 'PUT', { everyoneCanInvite })
    )
    return { status: response.status, body: await response.json() }
  }

  it('lets administrators invite while registration is closed and applies invite roles', async () => {
    const moderator = await prisma.role.create({
      data: {
        name: 'Moderator',
        position: 20,
        permissions: ['users.read', 'content.read'],
      },
    })
    expect((await join(undefined, 'Nobody')).status).toBe(404)

    const created = await create({
      note: 'For Sam',
      roleIds: [moderator.id],
    })
    expect(created.response.status).toBe(201)
    const invite = created.body.invite
    expect(invite).toMatchObject({
      note: 'For Sam',
      status: 'active',
      maxUses: 1,
      uses: 0,
      roles: [{ id: moderator.id, name: 'Moderator' }],
      canRevoke: true,
    })
    expect(invite.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const stored = await prisma.invite.findUniqueOrThrow({
      where: { id: invite.id },
    })
    expect(stored.token).not.toContain(invite.token)
    expect(stored.tokenHash).not.toBe(invite.token)

    const preview = await invites.inspectInvite(invite.token)
    expect(preview).toEqual({
      status: 'active',
      inviterName: 'Alex Admin',
      roles: [{ id: moderator.id, name: 'Moderator', color: '#64748b' }],
    })

    const joined = await join(invite.token, 'Sam Rivera')
    expect(joined.status).toBe(200)
    expect(joined.body.nextAction).toBe('sign_in')
    const sam = await prisma.user.findUniqueOrThrow({
      where: { id: joined.body.user.id },
      include: { roles: true },
    })
    expect(sam.inviteId).toBe(invite.id)
    expect(sam.roles.map((role) => role.name)).toEqual(['Moderator'])
    expect(
      (await service.getUserAccess(sam.id)).permissions.includes(
        'administrator'
      )
    ).toBe(false)

    expect(await join(invite.token, 'Second Person')).toEqual({
      status: 400,
      body: {
        error: 'This invite link has already been used.',
        code: 'invite_used',
      },
    })
    expect(await prisma.user.count()).toBe(3)

    const ended = await list('scope=mine&status=ended')
    expect(ended.status).toBe(200)
    expect(ended.body.invites).toEqual([
      expect.objectContaining({
        id: invite.id,
        status: 'used',
        uses: 1,
        token: null,
        canRevoke: false,
        memberCount: 1,
        members: [{ id: sam.id, name: 'Sam Rivera' }],
      }),
    ])
    expect((await list('scope=mine&status=active')).body.invites).toEqual([])

    authentication.userId = 'admin'
    const listed = await users.GET(call('/api/users', 'GET'))
    const accounts = (await listed.json()).data
    expect(
      accounts.find((user: { id: string }) => user.id === sam.id).invitedBy
    ).toEqual({ id: 'admin', name: 'Alex Admin' })

    const audit = await prisma.auditEvent.findMany({
      where: { category: 'invites' },
    })
    expect(audit.map((event) => event.action)).toEqual(
      expect.arrayContaining([
        'invite.create',
        'invite.update',
        'invite.redeem',
      ])
    )
    expect(
      audit.find((event) => event.action === 'invite.create')
    ).toMatchObject({ targetName: 'For Sam' })
    expect(
      audit.find((event) => event.action === 'invite.create')?.details
    ).toMatchObject({
      after: {
        id: invite.id,
        note: 'For Sam',
        creatorId: 'admin',
        maxUses: 1,
        uses: 0,
        roleIds: [moderator.id],
      },
    })
    const redeem = audit.find((event) => event.action === 'invite.redeem')
    expect(redeem).toMatchObject({
      targetId: invite.id,
      targetName: 'For Sam',
      details: expect.objectContaining({
        accountId: sam.id,
        accountName: 'Sam Rivera',
        roleIds: [moderator.id],
      }),
    })
    const serialized = JSON.stringify(audit)
    expect(serialized).not.toContain(invite.token)
    expect(serialized).not.toContain(stored.tokenHash)
    expect(serialized).not.toContain(stored.token)
  })

  it('keeps invites administrator-only until the Settings switch grants Everyone', async () => {
    expect((await create({}, 'member')).response.status).toBe(403)
    expect((await list('scope=mine', 'member')).status).toBe(403)
    expect((await setEveryone(true, 'member')).status).toBe(403)

    expect(await setEveryone(true)).toEqual({
      status: 200,
      body: { everyoneCanInvite: true },
    })
    const everyone = await prisma.role.findUniqueOrThrow({
      where: { systemKey: 'everyone' },
    })
    expect(everyone.permissions).toContain('invites.create')
    expect(
      everyone.permissions.filter((key) => key === 'invites.create')
    ).toHaveLength(1)
    expect((await setEveryone(true)).status).toBe(200)
    expect(
      (
        await prisma.role.findUniqueOrThrow({
          where: { systemKey: 'everyone' },
        })
      ).permissions.filter((key) => key === 'invites.create')
    ).toHaveLength(1)

    authentication.userId = 'admin'
    const read = await policy.GET()
    expect(await read.json()).toEqual({
      everyoneCanInvite: true,
      limits: { activeInvites: 5, usesPerInvite: 1, lifetimeDays: 30 },
    })

    // Member limits: single use, a bounded lifetime, and five active links.
    expect((await create({ maxUses: null }, 'member')).body.error).toBe(
      'Invites you create can be used once.'
    )
    expect((await create({ maxUses: 2 }, 'member')).response.status).toBe(400)
    expect((await create({ expiresInHours: null }, 'member')).body.error).toBe(
      'Invites you create must expire within 30 days.'
    )
    expect(
      (await create({ expiresInHours: 30 * 24 + 1 }, 'member')).response.status
    ).toBe(400)
    const helper = await prisma.role.create({
      data: { name: 'Helper', position: 5, permissions: ['files.read'] },
    })
    expect(
      (await create({ roleIds: [helper.id] }, 'member')).response.status
    ).toBe(403)

    const created = []
    for (let index = 0; index < 5; index += 1) {
      const result = await create(
        { note: `Friend ${index}`, expiresInHours: 30 * 24 },
        'member'
      )
      expect(result.response.status).toBe(201)
      created.push(result.body.invite)
    }
    const sixth = await create({}, 'member')
    expect(sixth.response.status).toBe(409)
    expect(sixth.body.error).toContain('5 active invites')

    const mine = await list('scope=mine', 'member')
    expect(mine.body.policy).toEqual({
      canCreate: true,
      canManage: false,
      canGrantRoles: false,
      limits: { activeInvites: 5, usesPerInvite: 1, lifetimeDays: 30 },
      activeCount: 5,
    })
    expect(mine.body.invites).toHaveLength(5)
    expect(
      mine.body.invites.every(
        (invite: { token: string | null }) => invite.token
      )
    ).toBe(true)
    expect((await list('scope=all', 'member')).status).toBe(403)

    // Administrators see every invite but can never copy another account's link.
    const all = await list('scope=all')
    expect(all.body.policy.limits).toBeNull()
    expect(all.body.invites).toHaveLength(5)
    expect(
      all.body.invites.every(
        (invite: { token: string | null; canRevoke: boolean }) =>
          invite.token === null && invite.canRevoke
      )
    ).toBe(true)

    // A member cannot revoke someone else's invite, even by guessing its ID.
    const adminInvite = (await create()).body.invite
    authentication.userId = 'member'
    expect(
      (
        await detail.DELETE(call(`/api/invites/${adminInvite.id}`, 'DELETE'), {
          params: Promise.resolve({ id: adminInvite.id }),
        })
      ).status
    ).toBe(404)

    authentication.userId = 'admin'
    const revoked = await detail.DELETE(
      call(`/api/invites/${created[0].id}`, 'DELETE'),
      { params: Promise.resolve({ id: created[0].id }) }
    )
    expect(revoked.status).toBe(200)
    expect((await revoked.json()).invite).toMatchObject({
      status: 'revoked',
      canRevoke: false,
      token: null,
    })
    expect((await join(created[0].token, 'Revoked Person')).body.code).toBe(
      'invite_revoked'
    )
    // Revoking frees a slot under the member limit.
    expect((await create({}, 'member')).response.status).toBe(201)

    // Turning the switch off pauses member invites until access returns.
    expect((await setEveryone(false)).body).toEqual({
      everyoneCanInvite: false,
    })
    expect((await list('scope=all')).body.invites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: created[1].id, status: 'paused' }),
      ])
    )
    expect(await invites.inspectInvite(created[1].token)).toEqual({
      status: 'paused',
    })
    expect((await join(created[1].token, 'Paused Person')).body.code).toBe(
      'invite_paused'
    )
    expect(
      await prisma.invite.findUniqueOrThrow({ where: { id: created[1].id } })
    ).toMatchObject({ uses: 0 })
    await setEveryone(true)
    expect((await join(created[1].token, 'Resumed Person')).status).toBe(200)
  })

  it('requires both security settings and invite permission for the switch', async () => {
    const security = await prisma.role.create({
      data: {
        name: 'Security',
        position: 50,
        permissions: ['settings.read', 'settings.security'],
      },
    })
    await account('security', 'Sky Security', [security.id])
    expect((await setEveryone(true, 'security')).body.error).toBe(
      'You can only change who may invite people when you can create invites yourself'
    )
    await prisma.role.update({
      where: { id: security.id },
      data: { permissions: { push: 'invites.create' } },
    })
    expect((await setEveryone(true, 'security')).status).toBe(200)
    expect((await setEveryone(true, 'member')).status).toBe(403)
  })

  it('rechecks delegated role grants when the invite is used', async () => {
    const helper = await prisma.role.create({
      data: { name: 'Helper', position: 10, permissions: ['users.read'] },
    })
    const lead = await prisma.role.create({
      data: {
        name: 'Lead',
        position: 50,
        permissions: ['invites.create', 'users.roles', 'users.read'],
      },
    })
    await account('lead', 'Lee Lead', [lead.id])
    const higher = await prisma.role.create({
      data: { name: 'Director', position: 80, permissions: ['users.read'] },
    })
    expect(
      (await create({ roleIds: [higher.id] }, 'lead')).response.status
    ).toBe(403)
    const granted = await create({ roleIds: [helper.id] }, 'lead')
    expect(granted.response.status).toBe(201)
    // Leads are limited like members because they cannot create users directly.
    expect(granted.body.invite.maxUses).toBe(1)

    await prisma.role.update({
      where: { id: lead.id },
      data: { permissions: ['invites.create', 'users.read'] },
    })
    expect((await join(granted.body.invite.token, 'Hopeful')).body.code).toBe(
      'invite_paused'
    )
    await prisma.role.update({
      where: { id: lead.id },
      data: { permissions: ['invites.create', 'users.roles', 'users.read'] },
    })
    const joined = await join(granted.body.invite.token, 'Helper Person')
    expect(joined.status).toBe(200)
    const person = await prisma.user.findUniqueOrThrow({
      where: { id: joined.body.user.id },
      include: { roles: true },
    })
    expect(person.roles.map((role) => role.id)).toEqual([helper.id])

    // A deleted role stops being granted rather than blocking the invite.
    const another = await create({ roleIds: [helper.id], maxUses: 1 }, 'lead')
    await prisma.role.delete({ where: { id: helper.id } })
    const plain = await join(another.body.invite.token, 'Plain Person')
    expect(plain.status).toBe(200)
    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { id: plain.body.user.id },
          include: { roles: true },
        })
      ).roles
    ).toEqual([])
  })

  it('creates exactly one account when a single-use link is used concurrently', async () => {
    const invite = (await create()).body.invite
    const results = await Promise.all(
      ['One', 'Two', 'Three', 'Four', 'Five'].map((name) =>
        join(invite.token, `Racer ${name}`)
      )
    )
    expect(results.filter((result) => result.status === 200)).toHaveLength(1)
    expect(
      results
        .filter((result) => result.status !== 200)
        .every((result) => result.body.code === 'invite_used')
    ).toBe(true)
    expect(await prisma.user.count({ where: { inviteId: invite.id } })).toBe(1)
    expect(
      (await prisma.invite.findUniqueOrThrow({ where: { id: invite.id } })).uses
    ).toBe(1)
  })

  it('rejects expired, unknown, and malformed links without spending a use', async () => {
    const team = (await create({ maxUses: 3 })).body.invite
    expect((await join(team.token, 'First Teammate')).status).toBe(200)
    // A duplicate email rolls the whole registration back, including the use.
    const duplicate = await register.POST(
      call('/api/auth/register', 'POST', {
        name: 'Duplicate',
        email: 'first.teammate@example.test',
        password: 'Invite-tests-only-2026',
        invite: team.token,
      })
    )
    expect(duplicate.status).toBe(400)
    expect(
      (await prisma.invite.findUniqueOrThrow({ where: { id: team.id } })).uses
    ).toBe(1)

    await prisma.invite.update({
      where: { id: team.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    expect((await join(team.token, 'Late Teammate')).body).toEqual({
      error: 'This invite link has expired.',
      code: 'invite_expired',
    })
    expect(await invites.inspectInvite(team.token)).toEqual({
      status: 'expired',
    })
    expect(
      (await join(randomBytes(32).toString('base64url'), 'Guess')).body.code
    ).toBe('invite_invalid')
    expect((await join('not-a-token', 'Malformed')).body.code).toBe(
      'invite_invalid'
    )
    expect(await invites.inspectInvite('../../etc')).toEqual({
      status: 'invalid',
    })

    // With registration open, an unusable invite still fails instead of
    // silently creating an account without its intended role grants.
    await settings.PATCH(
      call('/api/settings', 'PATCH', {
        settings: { general: { registrations: { enabled: true } } },
      })
    )
    expect((await join(team.token, 'Open Late')).body.code).toBe(
      'invite_expired'
    )
    expect((await join(undefined, 'Open Person')).status).toBe(200)
  })

  it('preserves other invite limits when one limit changes', async () => {
    authentication.userId = 'admin'
    const response = await settings.PATCH(
      call('/api/settings', 'PATCH', {
        settings: {
          general: { registrations: { inviteLimits: { activeInvites: 2 } } },
        },
      })
    )
    expect(response.status).toBe(200)
    await settings.PATCH(
      call('/api/settings', 'PATCH', {
        settings: {
          general: { registrations: { inviteLimits: { usesPerInvite: 3 } } },
        },
      })
    )
    const read = await (await policy.GET()).json()
    expect(read.limits).toEqual({
      activeInvites: 2,
      usesPerInvite: 3,
      lifetimeDays: 30,
    })
    expect(
      (
        await settings.PATCH(
          call('/api/settings', 'PATCH', {
            settings: {
              general: {
                registrations: { inviteLimits: { lifetimeDays: 0 } },
              },
            },
          })
        )
      ).status
    ).toBe(400)
  })

  it('removes a deleted creator’s invites but keeps the accounts they invited', async () => {
    const helper = await prisma.role.create({
      data: {
        name: 'Inviter',
        position: 30,
        permissions: ['invites.create'],
      },
    })
    await account('inviter', 'Ida Inviter', [helper.id])
    const invite = (await create({ note: 'Neighbor' }, 'inviter')).body.invite
    const joined = await join(invite.token, 'Kept Person')
    expect(joined.status).toBe(200)
    const { deleteAccountWithStorageCleanup } =
      await import('@/lib/storage/deletion')
    await deleteAccountWithStorageCleanup('admin', 'inviter', 'users.delete')
    expect(await prisma.invite.count()).toBe(0)
    expect(
      await prisma.auditEvent.findFirst({
        where: { action: 'invite.delete', targetId: invite.id },
      })
    ).toMatchObject({
      category: 'invites',
      actorId: 'admin',
      targetName: 'Neighbor',
      details: { reason: 'Account deleted', creatorId: 'inviter', uses: 1 },
    })
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: joined.body.user.id },
      })
    ).toMatchObject({ inviteId: null, name: 'Kept Person' })
  })

  it('batches creator access reads with the same result as single reads', async () => {
    const lead = await prisma.role.create({
      data: {
        name: 'Lead',
        position: 50,
        permissions: ['invites.create', 'users.roles'],
      },
    })
    await account('lead', 'Lee Lead', [lead.id])
    const batched = await service.getUsersAccess([
      'admin',
      'member',
      'lead',
      'missing',
    ])
    expect([...batched.keys()].sort()).toEqual(['admin', 'lead', 'member'])
    for (const id of ['admin', 'member', 'lead'])
      expect(batched.get(id)).toEqual(await service.getUserAccess(id))
    expect(await service.getUsersAccess([])).toEqual(new Map())
    // Joined-account lookups and creator deletion use this index.
    expect(
      await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'User' AND indexname = 'User_inviteId_idx'`
    ).toHaveLength(1)
  })

  it('validates list queries and create payloads', async () => {
    expect((await list('scope=everyone')).status).toBe(400)
    expect((await list('limit=500')).status).toBe(400)
    expect((await create({ note: 'x'.repeat(101) })).response.status).toBe(400)
    expect((await create({ extra: true })).response.status).toBe(400)
    expect((await create({ maxUses: 0 })).response.status).toBe(400)
    authentication.userId = null
    expect(
      (await collection.GET(call('/api/invites?scope=mine', 'GET'))).status
    ).toBe(401)
    authentication.userId = 'admin'
    const crossSite = await collection.POST(
      call(
        '/api/invites',
        'POST',
        { maxUses: 1 },
        { origin: 'https://attacker.example' }
      )
    )
    expect(crossSite.status).toBe(403)
    expect(await prisma.invite.count()).toBe(0)
    const id = randomUUID()
    expect(
      (
        await detail.DELETE(call(`/api/invites/${id}`, 'DELETE'), {
          params: Promise.resolve({ id }),
        })
      ).status
    ).toBe(404)
  })
})
