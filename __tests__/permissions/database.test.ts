import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { DEFAULT_EMAIL_CONFIG } from '@/lib/email/schema'
import { ALL_PERMISSIONS, DEFAULT_PERMISSIONS } from '@/lib/permissions/catalog'

const authentication = vi.hoisted(() => ({
  userId: 'admin',
  permissions: ['administrator'] as string[],
  signedIn: true,
}))
vi.mock('@/lib/auth', () => ({
  getAccessSession: async () =>
    authentication.signedIn
      ? {
          user: {
            id: authentication.userId,
            permissions: authentication.permissions,
          },
        }
      : null,
}))

const databaseUrl = process.env.FLARE_ROLES_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

suite.sequential('roles against disposable PostgreSQL', () => {
  let prisma: typeof import('@/lib/database/prisma').prisma
  let service: typeof import('@/lib/permissions/server')
  let collection: typeof import('@/app/api/roles/route')
  let detail: typeof import('@/app/api/roles/[id]/route')
  let createUser: typeof import('@/lib/users/create-user').createUser

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !/^\/flare_roles_test_/.test(url.pathname)
    )
      throw new Error('Use a disposable local flare_roles_test_ database')
    vi.stubEnv('DATABASE_URL', url.toString())
    prisma = (await import('@/lib/database/prisma')).prisma
    service = await import('@/lib/permissions/server')
    collection = await import('@/app/api/roles/route')
    detail = await import('@/app/api/roles/[id]/route')
    createUser = (await import('@/lib/users/create-user')).createUser
  })

  beforeEach(async () => {
    await prisma.user.deleteMany()
    await prisma.role.deleteMany()
    await prisma.config.deleteMany()
    const builtins = await prisma.$transaction(service.ensureBuiltInRoles)
    await prisma.user.create({
      data: {
        id: 'admin',
        email: 'admin@example.test',
        name: 'Admin',
        password: 'fixture-only',
        urlId: 'admin',
        uploadToken: 'admin-fixture',
        roles: { connect: { id: builtins.administrator.id } },
      },
    })
    await prisma.user.create({
      data: {
        id: 'member',
        email: 'member@example.test',
        name: 'Member',
        password: 'fixture-only',
        urlId: 'member',
        uploadToken: 'member-fixture',
      },
    })
    authentication.userId = 'admin'
    authentication.permissions = ['administrator']
    authentication.signedIn = true
  })
  afterAll(async () => {
    await prisma?.$disconnect()
    vi.unstubAllEnvs()
  })

  function request(method: string, body?: unknown) {
    return new Request('http://localhost/api/roles', {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }
  function context(id: string) {
    return { params: Promise.resolve({ id }) }
  }
  async function role(name: string, permissions: string[], position = 10) {
    return prisma.role.create({ data: { name, permissions, position } })
  }
  async function assign(userId: string, roleId: string) {
    return prisma.user.update({
      where: { id: userId },
      data: { roles: { connect: { id: roleId } } },
    })
  }
  async function locked(
    callback: (
      tx: Parameters<typeof service.lockRoleChanges>[0]
    ) => Promise<unknown>
  ) {
    return prisma.$transaction(async (tx) => {
      await service.lockRoleChanges(tx)
      return callback(tx)
    })
  }

  it('inherits Everyone dynamically, combines roles, and ignores legacy session claims', async () => {
    expect((await service.getUserAccess('member')).permissions).toEqual(
      DEFAULT_PERMISSIONS
    )
    const moderator = await role('Moderator', ['users.read', 'content.read'])
    await assign('member', moderator.id)
    expect((await service.getUserAccess('member')).permissions).toEqual(
      expect.arrayContaining(['files.upload', 'users.read', 'content.read'])
    )
    await prisma.role.update({
      where: { systemKey: 'everyone' },
      data: { permissions: ['files.read'] },
    })
    expect((await service.getUserAccess('member')).permissions).toEqual([
      'files.read',
      'users.read',
      'content.read',
    ])
    expect((await service.getUserAccess('admin')).permissions).toEqual(
      ALL_PERMISSIONS
    )
    expect(await service.getUserAccess('deleted')).toEqual({
      roles: [],
      permissions: [],
    })
  })

  it('creates exactly one first administrator under simultaneous registration', async () => {
    await prisma.user.deleteMany()
    const created = await Promise.all(
      ['one', 'two', 'three'].map((name) =>
        prisma.$transaction((tx) =>
          createUser(tx, {
            name,
            email: `${name}@example.test`,
            password: 'fixture-only',
          })
        )
      )
    )
    const access = await Promise.all(
      created.map((user) => service.getUserAccess(user.id))
    )
    expect(
      access.filter((user) => user.permissions.includes('administrator'))
    ).toHaveLength(1)
    expect(
      access.every((user) =>
        user.roles.some((role) => role.systemKey === 'everyone')
      )
    ).toBe(true)
  })

  it('enforces hierarchy and permission subsets for role edits and assignments', async () => {
    const manager = await role(
      'Role manager',
      ['roles.manage', 'users.roles', 'users.read'],
      50
    )
    const lower = await role('Reader', ['users.read'], 10)
    const peer = await role('Peer', ['users.read'], 50)
    await assign('member', manager.id)
    const newcomer = await prisma.user.create({
      data: { id: 'newcomer', urlId: 'newcomer', uploadToken: 'newcomer' },
    })
    authentication.userId = 'member'
    authentication.permissions = ['roles.manage', 'users.roles', 'users.read']
    expect(
      (
        await collection.POST(
          request('POST', { name: 'Elevated', permissions: ['administrator'] })
        )
      ).status
    ).toBe(403)
    expect(
      (
        await collection.POST(
          request('POST', { name: 'Too high', position: 50 })
        )
      ).status
    ).toBe(403)
    expect(
      (
        await collection.POST(
          request('POST', {
            name: 'Too powerful',
            permissions: ['users.delete'],
          })
        )
      ).status
    ).toBe(403)
    expect(
      (
        await collection.POST(
          request('POST', {
            name: 'Allowed',
            position: 20,
            permissions: ['users.read'],
          })
        )
      ).status
    ).toBe(201)
    expect(
      (
        await detail.PATCH(
          request('PATCH', { position: 60 }),
          context(lower.id)
        )
      ).status
    ).toBe(403)
    expect(
      (await detail.DELETE(request('DELETE'), context(peer.id))).status
    ).toBe(403)
    await expect(
      locked((tx) =>
        service.validateRoleAssignment(tx, 'member', newcomer.id, [lower.id])
      )
    ).resolves.toMatchObject([{ id: lower.id }])
    await expect(
      locked((tx) =>
        service.validateRoleAssignment(tx, 'member', newcomer.id, [peer.id])
      )
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      locked((tx) =>
        service.validateRoleAssignment(tx, 'member', 'admin', [lower.id])
      )
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      locked((tx) => service.validateRoleAssignment(tx, 'member', 'member', []))
    ).rejects.toMatchObject({ status: 403 })
  })

  it('rejects Everyone assignment, unknown roles, duplicates, and reserved role mutations', async () => {
    const everyone = await prisma.role.findUniqueOrThrow({
      where: { systemKey: 'everyone' },
    })
    for (const ids of [[everyone.id], ['missing'], [everyone.id, everyone.id]])
      await expect(
        locked((tx) =>
          service.validateRoleAssignment(tx, 'admin', 'member', ids)
        )
      ).rejects.toMatchObject({ status: 400 })
    expect(
      (await detail.DELETE(request('DELETE'), context(everyone.id))).status
    ).toBe(400)
    for (const body of [
      { name: 'Renamed' },
      { position: 1 },
      { permissions: ['administrator'] },
    ])
      expect(
        (await detail.PATCH(request('PATCH', body), context(everyone.id)))
          .status
      ).toBe(400)
    expect(
      (
        await detail.PATCH(
          request('PATCH', { permissions: ['files.read'] }),
          context(everyone.id)
        )
      ).status
    ).toBe(200)
  })

  it('rolls back last-administrator permission removal, role deletion, and account removal', async () => {
    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { systemKey: 'administrator' },
    })
    expect(
      (
        await detail.PATCH(
          request('PATCH', { permissions: [] }),
          context(adminRole.id)
        )
      ).status
    ).toBe(409)
    expect(
      (await detail.DELETE(request('DELETE'), context(adminRole.id))).status
    ).toBe(409)
    await expect(
      locked(async (tx) => {
        await tx.user.delete({ where: { id: 'admin' } })
        await service.assertAccessibleAdministrator(tx)
      })
    ).rejects.toMatchObject({ status: 409 })
    expect(
      (await prisma.role.findUniqueOrThrow({ where: { id: adminRole.id } }))
        .permissions
    ).toEqual(['administrator'])
    expect(await prisma.user.count({ where: { id: 'admin' } })).toBe(1)
    const secondAdmin = await role('Owner', ['administrator'], 1)
    await assign('member', secondAdmin.id)
    expect(
      (await detail.DELETE(request('DELETE'), context(adminRole.id))).status
    ).toBe(200)
  })

  it('requires a durable administrator recovery path and working sign-in method', async () => {
    const config = structuredClone(DEFAULT_EMAIL_CONFIG)
    config.enabled = true
    config.verification.mode = 'all_users'
    config.verification.graceEndsAt = '2099-01-01T00:00:00.000Z'
    await expect(
      locked((tx) => service.assertAccessibleAdministrator(tx, config))
    ).rejects.toMatchObject({ status: 409 })
    await prisma.user.update({
      where: { id: 'admin' },
      data: { emailExempt: true },
    })
    await expect(
      locked((tx) => service.assertAccessibleAdministrator(tx, config))
    ).resolves.toBeUndefined()
    await prisma.user.update({ where: { id: 'admin' }, data: { email: null } })
    await expect(
      locked((tx) => service.assertAccessibleAdministrator(tx, config))
    ).rejects.toMatchObject({ status: 409 })
    await prisma.user.update({
      where: { id: 'admin' },
      data: { password: null, email: 'admin@example.test' },
    })
    await expect(
      locked((tx) => service.assertAccessibleAdministrator(tx, config))
    ).rejects.toMatchObject({ status: 409 })
    const { DEFAULT_CONFIG } = await import('@/lib/config')
    const instance = structuredClone(DEFAULT_CONFIG)
    instance.settings.general.oidc = {
      ...instance.settings.general.oidc,
      enabled: true,
      issuer: 'https://issuer.example/',
      clientId: 'client',
      clientSecret: 'fixture-secret',
    }
    await prisma.config.create({
      data: { key: 'flare_config', value: instance },
    })
    await prisma.user.update({
      where: { id: 'admin' },
      data: { oidcSubject: 'https://issuer.example|subject' },
    })
    await expect(
      locked((tx) => service.assertAccessibleAdministrator(tx, config))
    ).resolves.toBeUndefined()
  })

  it('rechecks authority after locking even when the session still claims Administrator', async () => {
    await prisma.user.update({
      where: { id: 'admin' },
      data: { roles: { set: [] } },
    })
    expect(
      (
        await collection.POST(
          request('POST', {
            name: 'Escalation',
            permissions: ['administrator'],
          })
        )
      ).status
    ).toBe(403)
    expect(await prisma.role.count({ where: { name: 'Escalation' } })).toBe(0)
  })

  it('serializes simultaneous demotions so one accessible administrator always remains', async () => {
    const second = await role('Second admin', ['administrator'], 101)
    await assign('member', second.id)
    const outcomes = await Promise.allSettled(
      ['admin', 'member'].map((id) =>
        locked(async (tx) => {
          await tx.user.update({ where: { id }, data: { roles: { set: [] } } })
          await service.assertAccessibleAdministrator(tx)
        })
      )
    )
    expect(
      outcomes.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(1)
    expect(
      await prisma.user.count({
        where: { roles: { some: { permissions: { has: 'administrator' } } } },
      })
    ).toBe(1)
  })

  it('requires session permissions, reports member counts, and returns useful validation errors', async () => {
    authentication.signedIn = false
    expect((await collection.GET()).status).toBe(401)
    expect(
      (await collection.POST(request('POST', { name: 'Denied' }))).status
    ).toBe(401)
    authentication.signedIn = true
    authentication.permissions = []
    expect((await collection.GET()).status).toBe(403)
    authentication.permissions = ['users.read']
    const response = await collection.GET()
    expect(
      (await response.json()).roles.find(
        (role: { systemKey: string }) => role.systemKey === 'everyone'
      ).memberCount
    ).toBe(2)
    authentication.permissions = ['administrator']
    expect(
      (
        await collection.POST(
          request('POST', { name: 'Invalid', permissions: ['typo'] })
        )
      ).status
    ).toBe(400)
    expect(
      (
        await detail.PATCH(
          request('PATCH', { name: 'Missing' }),
          context('missing')
        )
      ).status
    ).toBe(404)
  })

  it('blocks cross-origin, form, malformed, and oversized role writes before persistence', async () => {
    const everyone = await prisma.role.findUniqueOrThrow({
      where: { systemKey: 'everyone' },
    })
    const foreign = new Request('http://localhost/api/roles', {
      method: 'POST',
      headers: {
        Origin: 'https://attacker.example',
        'Content-Type': 'application/json',
      },
      body: '{"name":"Unwanted"}',
    })
    expect((await collection.POST(foreign)).status).toBe(403)
    const deletion = new Request('http://localhost/api/roles/id', {
      method: 'DELETE',
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    })
    expect((await detail.DELETE(deletion, context(everyone.id))).status).toBe(
      403
    )
    expect(
      (
        await collection.POST(
          new Request('http://localhost/api/roles', {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: '{}',
          })
        )
      ).status
    ).toBe(415)
    expect(
      (
        await collection.POST(
          new Request('http://localhost/api/roles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{',
          })
        )
      ).status
    ).toBe(400)
    expect(
      (await collection.POST(request('POST', { name: 'x'.repeat(33 * 1024) })))
        .status
    ).toBe(413)
    expect(await prisma.role.count()).toBe(2)
    expect((await collection.GET()).headers.get('cache-control')).toBe(
      'private, no-store'
    )
  })

  it('enforces the instance role limit under the mutation lock', async () => {
    await prisma.role.createMany({
      data: Array.from({ length: 98 }, (_, i) => ({
        name: `Role ${i}`,
        permissions: [],
      })),
    })
    expect(
      (await collection.POST(request('POST', { name: 'Over limit' }))).status
    ).toBe(400)
    expect(await prisma.role.count()).toBe(100)
  })

  it('prevents taking over a lower-ranked account with permissions the manager cannot grant', async () => {
    const manager = await role(
      'Account manager',
      ['users.update', 'users.roles'],
      50
    )
    const sensitive = await role('Storage operator', ['settings.storage'], 10)
    await assign('member', manager.id)
    const target = await prisma.user.create({
      data: {
        id: 'operator',
        name: 'Operator',
        email: 'operator@example.test',
        password: 'original-hash',
        urlId: 'oper1',
        uploadToken: 'operator-fixture',
        roles: { connect: { id: sensitive.id } },
      },
    })
    authentication.userId = 'member'
    authentication.permissions = ['users.update', 'users.roles']
    await expect(
      locked((tx) => service.assertCanManageUser(tx, 'member', target.id))
    ).rejects.toMatchObject({ status: 403 })
    const users = await import('@/app/api/users/route')
    const response = await users.PUT(
      new Request('http://localhost/api/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: target.id, password: 'attacker-password' }),
      })
    )
    expect(response.status).toBe(403)
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: target.id } }))
        .password
    ).toBe('original-hash')
    await expect(
      locked((tx) =>
        service.validateRoleAssignment(tx, 'member', target.id, [])
      )
    ).rejects.toMatchObject({ status: 403 })
  })

  it('keeps delegated settings atomic, protects executable markup, and preserves redacted storage credentials', async () => {
    const { DEFAULT_CONFIG } = await import('@/lib/config')
    const initial = structuredClone(DEFAULT_CONFIG)
    initial.settings.general.storage.s3 = {
      ...initial.settings.general.storage.s3,
      bucket: 'old-bucket',
      accessKeyId: 'fixture-key',
      secretAccessKey: 'fixture-secret',
    }
    await prisma.config.create({
      data: { key: 'flare_config', value: initial },
    })
    const editor = await role(
      'Settings editor',
      ['appearance.manage', 'settings.storage'],
      30
    )
    await assign('member', editor.id)
    authentication.userId = 'member'
    authentication.permissions = ['appearance.manage', 'settings.storage']
    const settings = await import('@/app/api/settings/route')
    function patch(value: unknown) {
      return settings.PATCH(
        new Request('http://localhost/api/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings: value }),
        })
      )
    }
    expect(
      (
        await patch({
          advanced: { customHead: '<img src=x onerror=alert(1)>' },
        })
      ).status
    ).toBe(403)
    expect(
      (
        await patch({
          appearance: { theme: 'light' },
          general: { storage: { provider: 'unsupported' } },
        })
      ).status
    ).toBe(400)
    const unchanged = (
      await prisma.config.findUniqueOrThrow({ where: { key: 'flare_config' } })
    ).value
    expect(unchanged).toEqual(JSON.parse(JSON.stringify(initial)))
    expect(
      (
        await patch({
          general: {
            storage: {
              s3: {
                bucket: 'new-bucket',
                accessKeyId: '',
                secretAccessKey: '',
              },
            },
          },
        })
      ).status
    ).toBe(200)
    const stored = (
      await prisma.config.findUniqueOrThrow({ where: { key: 'flare_config' } })
    ).value as unknown as typeof initial
    expect(stored.settings.general.storage.s3).toMatchObject({
      bucket: 'new-bucket',
      accessKeyId: 'fixture-key',
      secretAccessKey: 'fixture-secret',
    })
    // The session still carries the old grant. Authority is read again under the settings lock.
    await prisma.role.update({
      where: { id: editor.id },
      data: { permissions: ['appearance.manage'] },
    })
    expect(
      (await patch({ general: { storage: { s3: { bucket: 'stale-write' } } } }))
        .status
    ).toBe(403)
    expect(
      (
        (
          await prisma.config.findUniqueOrThrow({
            where: { key: 'flare_config' },
          })
        ).value as unknown as typeof initial
      ).settings.general.storage.s3.bucket
    ).toBe('new-bucket')
  })

  it('blocks disabling or replacing the sole administrator’s OIDC sign-in provider', async () => {
    const { DEFAULT_CONFIG } = await import('@/lib/config')
    const initial = structuredClone(DEFAULT_CONFIG)
    initial.settings.general.oidc = {
      ...initial.settings.general.oidc,
      enabled: true,
      issuer: 'https://issuer.example/',
      clientId: 'client',
      clientSecret: 'fixture-secret',
    }
    await prisma.config.create({
      data: { key: 'flare_config', value: initial },
    })
    await prisma.user.update({
      where: { id: 'admin' },
      data: { password: null, oidcSubject: 'https://issuer.example|subject' },
    })
    const settings = await import('@/app/api/settings/route')
    for (const oidc of [
      { enabled: false },
      { issuer: 'https://other-issuer.example' },
    ]) {
      const response = await settings.PATCH(
        new Request('http://localhost/api/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings: { general: { oidc } } }),
        })
      )
      expect(response.status).toBe(409)
    }
    const current = (
      await prisma.config.findUniqueOrThrow({ where: { key: 'flare_config' } })
    ).value as unknown as typeof initial
    expect(current.settings.general.oidc).toEqual(initial.settings.general.oidc)
    await prisma.user.update({
      where: { id: 'admin' },
      data: { password: 'local-recovery-hash' },
    })
    expect(
      (
        await settings.PATCH(
          new Request('http://localhost/api/settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              settings: { general: { oidc: { enabled: false } } },
            }),
          })
        )
      ).status
    ).toBe(200)
  })

  it('migrates legacy authority without losing identities or content', async () => {
    const schema = `migration_${Date.now()}`
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
    const url = new URL(databaseUrl!)
    url.searchParams.set('schema', schema)
    const legacy = new PrismaClient({
      datasources: { db: { url: url.toString() } },
    })
    try {
      const initial = readFileSync(
        'prisma/migrations/20250217061619_init/migration.sql',
        'utf8'
      )
      for (const sql of initial
        .split(';')
        .map((sql) => sql.trim())
        .filter(Boolean))
        await legacy.$executeRawUnsafe(sql)
      for (const [id, authority] of [
        ['owner', 'ADMIN'],
        ['member', 'USER'],
      ])
        await legacy.$executeRawUnsafe(
          `INSERT INTO "User" ("id", "role", "updatedAt", "urlId", "uploadToken") VALUES ($1, $2::"UserRole", NOW(), $1, $1)`,
          id,
          authority
        )
      await legacy.$executeRawUnsafe(
        `INSERT INTO "File" ("id", "name", "urlPath", "mimeType", "size", "userId", "path") VALUES ('file', 'Kept.png', '/kept', 'image/png', 1, 'owner', '/fixture')`
      )
      const migration = readFileSync(
        'prisma/migrations/20260926010000_roles/migration.sql',
        'utf8'
      )
      for (const sql of migration
        .split(';')
        .map((sql) => sql.trim())
        .filter(Boolean))
        await legacy.$executeRawUnsafe(sql)
      const roles = await legacy.role.findMany({
        include: { users: { select: { id: true } } },
      })
      expect(
        roles.find((role) => role.systemKey === 'administrator')?.users
      ).toEqual([{ id: 'owner' }])
      expect(
        roles.find((role) => role.systemKey === 'everyone')?.permissions
      ).toEqual(DEFAULT_PERMISSIONS)
      expect(await legacy.$queryRawUnsafe('SELECT "name" FROM "File"')).toEqual(
        [{ name: 'Kept.png' }]
      )
      expect(
        await legacy.$queryRawUnsafe(
          `SELECT "column_name" FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'User' AND column_name = 'role'`,
          schema
        )
      ).toEqual([])
    } finally {
      await legacy.$disconnect()
      await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`)
    }
  })
})
