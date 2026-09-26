import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Prisma, PrismaClient } from '@prisma/client'
import { mockClient } from 'aws-sdk-client-mock'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { DEFAULT_EMAIL_CONFIG } from '@/lib/email/schema'
import { ALL_PERMISSIONS, DEFAULT_PERMISSIONS } from '@/lib/permissions/catalog'
import { s3StorageTarget } from '@/lib/storage/targets'

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
  let cleanup: typeof import('@/lib/storage/deletion')
  let LocalStorage: typeof import('@/lib/storage/providers/local').LocalStorageProvider
  const cleanupPaths = new Set<string>()
  const cleanupPrefix = `uploads/roles-cleanup-test-${randomUUID()}`
  const s3Mock = mockClient(S3Client)

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
    cleanup = await import('@/lib/storage/deletion')
    LocalStorage = (await import('@/lib/storage/providers/local'))
      .LocalStorageProvider
  })

  beforeEach(async () => {
    s3Mock.reset()
    await prisma.storageDeletion.deleteMany()
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
  afterEach(async () => {
    vi.restoreAllMocks()
    for (const path of cleanupPaths) await rm(path, { force: true })
    cleanupPaths.clear()
  })
  afterAll(async () => {
    s3Mock.restore()
    await rm(cleanupPrefix, { force: true, recursive: true })
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

  async function cleanupAccount() {
    const id = `cleanup-${randomUUID()}`
    return prisma.user.create({
      data: {
        id,
        name: 'Cleanup fixture',
        email: `${id}@example.test`,
        password: 'fixture-only',
        urlId: id,
        uploadToken: id,
        avatarStoragePath: `uploads/avatars/${id}.jpg`,
        avatarStorageTarget: await cleanupTarget(),
      },
    })
  }

  async function cleanupFile(
    userId: string,
    name = 'fixture.txt',
    path = `${cleanupPrefix}/${randomUUID()}/${name}`
  ) {
    return prisma.file.create({
      data: {
        userId,
        name,
        path,
        urlPath: `/${randomUUID()}`,
        mimeType: 'text/plain',
        size: 1,
        storageTarget: await cleanupTarget(),
      },
    })
  }

  async function cleanupTarget() {
    const { DEFAULT_CONFIG, configSchema } = await import('@/lib/config')
    const row = await prisma.config.findUnique({
      where: { key: 'flare_config' },
    })
    const storage = configSchema.parse(row?.value ?? DEFAULT_CONFIG).settings
      .general.storage
    return storage.provider === 's3'
      ? s3StorageTarget(storage.s3)
      : { provider: 'local' as const }
  }

  async function cleanupConfig(provider: 'local' | 's3' = 'local') {
    const { DEFAULT_CONFIG } = await import('@/lib/config')
    const config = structuredClone(DEFAULT_CONFIG)
    config.settings.general.storage = {
      ...config.settings.general.storage,
      provider,
      s3: {
        bucket: 'cleanup-original',
        region: 'us-east-1',
        endpoint: 'https://s3.example.test',
        forcePathStyle: true,
        accessKeyId: 'fixture-access',
        secretAccessKey: 'fixture-secret',
      },
    }
    await prisma.config.upsert({
      where: { key: 'flare_config' },
      create: { key: 'flare_config', value: config },
      update: { value: config },
    })
    return config
  }

  it.each(['self', 'administrator'] as const)(
    'durably queues %s account bytes and avatar before cascading, without storage I/O in the request',
    async (kind) => {
      const user = await cleanupAccount()
      const file = await cleanupFile(user.id)
      const avatar = `uploads/avatars/${user.id}.jpg`
      const storage = new LocalStorage()
      await storage.uploadFile(
        Buffer.from('retained until worker'),
        file.path,
        'text/plain'
      )
      await storage.uploadFile(
        Buffer.from('avatar fixture'),
        avatar,
        'image/jpeg'
      )
      cleanupPaths.add(file.path)
      cleanupPaths.add(avatar)
      await prisma.user.update({
        where: { id: user.id },
        data: { image: `/api/avatars/${user.id}.jpg` },
      })
      const remove = vi.spyOn(LocalStorage.prototype, 'deleteFile')
      let response: Response
      if (kind === 'self') {
        authentication.userId = user.id
        authentication.permissions = [...DEFAULT_PERMISSIONS]
        const route = await import('@/app/api/profile/route')
        response = await route.DELETE(
          new Request('http://localhost/api/profile', { method: 'DELETE' })
        )
      } else {
        const route = await import('@/app/api/users/[id]/route')
        response = await route.DELETE(
          new Request(`http://localhost/api/users/${user.id}`, {
            method: 'DELETE',
          }),
          context(user.id)
        )
      }
      expect(response.status).toBe(204)
      expect(remove).not.toHaveBeenCalled()
      expect(
        await prisma.user.findUnique({ where: { id: user.id } })
      ).toBeNull()
      expect(await prisma.file.count({ where: { userId: user.id } })).toBe(0)
      expect(
        (await prisma.storageDeletion.findMany({ where: { ownerId: user.id } }))
          .map((job) => job.path)
          .sort()
      ).toEqual([file.path, avatar].sort())
      expect((await readFile(file.path)).toString()).toBe(
        'retained until worker'
      )
      const jobs = await cleanup.claimStorageDeletions()
      expect(
        await Promise.all(jobs.map(cleanup.processStorageDeletion))
      ).toEqual([true, true])
      await expect(readFile(file.path)).rejects.toMatchObject({
        code: 'ENOENT',
      })
      await expect(readFile(avatar)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await prisma.storageDeletion.count()).toBe(0)
    }
  )

  it('rolls back queued cleanup and leaves physical bytes untouched when the final administrator cannot be deleted', async () => {
    const file = await cleanupFile('admin')
    await new LocalStorage().uploadFile(
      Buffer.from('administrator bytes'),
      file.path,
      'text/plain'
    )
    cleanupPaths.add(file.path)
    const remove = vi.spyOn(LocalStorage.prototype, 'deleteFile')
    await expect(
      cleanup.deleteAccountWithStorageCleanup(
        'admin',
        'admin',
        'profile.update',
        true
      )
    ).rejects.toMatchObject({ status: 409 })
    expect(await prisma.user.count({ where: { id: 'admin' } })).toBe(1)
    expect(await prisma.file.count({ where: { id: file.id } })).toBe(1)
    expect(await prisma.storageDeletion.count()).toBe(0)
    expect(remove).not.toHaveBeenCalled()
    expect((await readFile(file.path)).toString()).toBe('administrator bytes')
  })

  it('rolls back queue inserts and cascades together when deletion fails after queueing', async () => {
    const user = await cleanupAccount()
    const file = await cleanupFile(user.id)
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION roles_test_reject_account_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected account deletion failure'; END $$`
    )
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER roles_test_reject_account_delete BEFORE DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION roles_test_reject_account_delete()`
    )
    try {
      await expect(
        cleanup.deleteAccountWithStorageCleanup(
          'admin',
          user.id,
          'users.delete'
        )
      ).rejects.toThrow('injected account deletion failure')
      expect(await prisma.storageDeletion.count()).toBe(0)
      expect(await prisma.user.count({ where: { id: user.id } })).toBe(1)
      expect(await prisma.file.count({ where: { id: file.id } })).toBe(1)
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER roles_test_reject_account_delete ON "User"'
      )
      await prisma.$executeRawUnsafe(
        'DROP FUNCTION roles_test_reject_account_delete()'
      )
    }
  })

  it('retries transient storage failures after backoff and recovers a claimed job after a worker restart', async () => {
    const user = await cleanupAccount()
    const file = await cleanupFile(user.id)
    await new LocalStorage().uploadFile(
      Buffer.from('retry me'),
      file.path,
      'text/plain'
    )
    cleanupPaths.add(file.path)
    await cleanup.deleteAccountWithStorageCleanup(
      'admin',
      user.id,
      'users.delete'
    )
    await prisma.storageDeletion.deleteMany({
      where: { path: { not: file.path } },
    })
    const remove = vi.spyOn(LocalStorage.prototype, 'deleteFile')
    remove.mockRejectedValueOnce(
      Object.assign(new Error('private provider details'), { code: 'EACCES' })
    )
    const [first] = await cleanup.claimStorageDeletions()
    const failedAt = Date.now()
    expect(await cleanup.processStorageDeletion(first)).toBe(false)
    const pending = await prisma.storageDeletion.findUniqueOrThrow({
      where: { id: first.id },
    })
    expect(pending).toMatchObject({
      status: 'pending',
      attempts: 1,
      leaseId: null,
      leaseUntil: null,
    })
    expect(pending.availableAt.getTime()).toBeGreaterThanOrEqual(
      failedAt + cleanup.STORAGE_DELETION_RETRY_MS
    )
    expect(pending.lastError).not.toContain('private provider details')
    expect(await cleanup.claimStorageDeletions()).toEqual([])
    await prisma.storageDeletion.update({
      where: { id: first.id },
      data: { availableAt: new Date(0) },
    })
    const [crashed] = await cleanup.claimStorageDeletions()
    // The process dies after claiming; the independent durable row survives.
    await prisma.storageDeletion.update({
      where: { id: first.id },
      data: { leaseUntil: new Date(0) },
    })
    await prisma.$disconnect()
    const [recovered] = await cleanup.claimStorageDeletions()
    expect(recovered.attempts).toBe(3)
    expect(recovered.leaseId).not.toBe(crashed.leaseId)
    expect(await cleanup.processStorageDeletion(crashed)).toBe(false)
    expect(remove).toHaveBeenCalledTimes(1)
    expect(await cleanup.processStorageDeletion(recovered)).toBe(true)
    expect(remove).toHaveBeenCalledTimes(2)
    expect(await prisma.storageDeletion.count()).toBe(0)
    await expect(readFile(file.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retries safely after bytes disappear but the worker crashes before acknowledging', async () => {
    const user = await cleanupAccount()
    const file = await cleanupFile(user.id)
    await new LocalStorage().uploadFile(
      Buffer.from('one deletion'),
      file.path,
      'text/plain'
    )
    cleanupPaths.add(file.path)
    await cleanup.deleteAccountWithStorageCleanup(
      'admin',
      user.id,
      'users.delete'
    )
    await prisma.storageDeletion.deleteMany({
      where: { path: { not: file.path } },
    })
    const [crashed] = await cleanup.claimStorageDeletions()
    await new LocalStorage().deleteFile(file.path)
    await prisma.storageDeletion.update({
      where: { id: crashed.id },
      data: { leaseUntil: new Date(0) },
    })
    const [recovered] = await cleanup.claimStorageDeletions()
    expect(await cleanup.processStorageDeletion(recovered)).toBe(true)
    expect(await prisma.storageDeletion.count()).toBe(0)
  })

  it('fences a slow worker acknowledgement after its expired lease is reclaimed', async () => {
    const user = await cleanupAccount()
    const file = await cleanupFile(user.id)
    await new LocalStorage().uploadFile(
      Buffer.from('slow storage'),
      file.path,
      'text/plain'
    )
    cleanupPaths.add(file.path)
    await cleanup.deleteAccountWithStorageCleanup(
      'admin',
      user.id,
      'users.delete'
    )
    await prisma.storageDeletion.deleteMany({
      where: { path: { not: file.path } },
    })
    let started!: () => void
    let release!: () => void
    const enteredStorage = new Promise<void>((resolve) => {
      started = resolve
    })
    const deferredStorage = new Promise<void>((resolve) => {
      release = resolve
    })
    const original = LocalStorage.prototype.deleteFile
    vi.spyOn(LocalStorage.prototype, 'deleteFile').mockImplementationOnce(
      async function (this: InstanceType<typeof LocalStorage>, path) {
        started()
        await deferredStorage
        await original.call(this, path)
      }
    )
    const [slow] = await cleanup.claimStorageDeletions()
    const processing = cleanup.processStorageDeletion(slow)
    try {
      await enteredStorage
      // A process pause outlasts its lease while the storage request is in flight.
      await prisma.storageDeletion.update({
        where: { id: slow.id },
        data: { leaseUntil: new Date(0) },
      })
      const [recovered] = await cleanup.claimStorageDeletions()
      release()
      expect(await processing).toBe(false)
      expect(
        await prisma.storageDeletion.findUnique({ where: { id: slow.id } })
      ).toMatchObject({ leaseId: recovered.leaseId, status: 'processing' })
      // The new owner handles the already removed object idempotently.
      expect(await cleanup.processStorageDeletion(recovered)).toBe(true)
      expect(await prisma.storageDeletion.count()).toBe(0)
    } finally {
      release()
      await processing
    }
  })

  it('bounds concurrent claims globally and never discards repeatedly failing jobs', async () => {
    const user = await cleanupAccount()
    for (let i = 0; i < 8; i++) await cleanupFile(user.id)
    await cleanup.deleteAccountWithStorageCleanup(
      'admin',
      user.id,
      'users.delete'
    )
    const claims = (
      await Promise.all(
        Array.from({ length: 12 }, () => cleanup.claimStorageDeletions())
      )
    ).flat()
    expect(claims).toHaveLength(cleanup.STORAGE_DELETION_CONCURRENCY)
    expect(new Set(claims.map((job) => job.id)).size).toBe(claims.length)
    expect(await cleanup.claimStorageDeletions()).toEqual([])
    const job = claims[0]
    await prisma.storageDeletion.update({
      where: { id: job.id },
      data: { attempts: 100 },
    })
    vi.spyOn(LocalStorage.prototype, 'deleteFile').mockRejectedValue(
      new Error('offline')
    )
    const started = Date.now()
    expect(
      await cleanup.processStorageDeletion({ ...job, attempts: 100 })
    ).toBe(false)
    const retained = await prisma.storageDeletion.findUniqueOrThrow({
      where: { id: job.id },
    })
    expect(retained.attempts).toBe(100)
    expect(retained.availableAt.getTime()).toBeGreaterThanOrEqual(
      started + cleanup.STORAGE_DELETION_MAX_RETRY_MS
    )
    expect(retained.availableAt.getTime()).toBeLessThan(
      Date.now() + cleanup.STORAGE_DELETION_MAX_RETRY_MS + 1000
    )
  })

  it('pins S3 destinations, uses fresh matching credentials, and never falls back to local', async () => {
    const config = await cleanupConfig('s3')
    const user = await cleanupAccount()
    const file = await cleanupFile(user.id)
    await prisma.user.update({
      where: { id: user.id },
      data: {
        image: `https://s3.example.test/cleanup-original/avatars/${user.id}.jpg`,
      },
    })
    await cleanup.deleteAccountWithStorageCleanup(
      'admin',
      user.id,
      'users.delete'
    )
    const jobs = await prisma.storageDeletion.findMany()
    expect(jobs).toHaveLength(2)
    expect(jobs.every((job) => job.provider === 's3')).toBe(true)
    expect(jobs.map((job) => job.path)).toContain(
      `uploads/avatars/${user.id}.jpg`
    )
    expect(JSON.stringify(jobs)).not.toContain('fixture-secret')
    expect(JSON.stringify(jobs)).not.toContain('fixture-access')
    const localDelete = vi.spyOn(LocalStorage.prototype, 'deleteFile')
    config.settings.general.storage.s3.bucket = 'different-bucket'
    await prisma.config.update({
      where: { key: 'flare_config' },
      data: { value: config },
    })
    s3Mock.on(DeleteObjectCommand).resolves({})
    const mismatched = await cleanup.claimStorageDeletions()
    expect(
      await Promise.all(mismatched.map(cleanup.processStorageDeletion))
    ).toEqual([false, false])
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0)
    expect(localDelete).not.toHaveBeenCalled()
    expect(
      (await prisma.storageDeletion.findMany()).every((job) =>
        job.lastError?.includes('Storage target changed')
      )
    ).toBe(true)
    config.settings.general.storage.provider = 'local'
    config.settings.general.storage.s3.bucket = 'cleanup-original'
    config.settings.general.storage.s3.accessKeyId = 'rotated-access'
    config.settings.general.storage.s3.secretAccessKey = 'rotated-secret'
    await prisma.config.update({
      where: { key: 'flare_config' },
      data: { value: config },
    })
    await prisma.storageDeletion.updateMany({
      data: { availableAt: new Date(0) },
    })
    const matching = await cleanup.claimStorageDeletions()
    expect(
      await Promise.all(matching.map(cleanup.processStorageDeletion))
    ).toEqual([true, true])
    expect(
      s3Mock.commandCalls(DeleteObjectCommand).map((call) => call.args[0].input)
    ).toEqual(
      expect.arrayContaining([
        {
          Bucket: 'cleanup-original',
          Key: file.path.replace(/^uploads\//, ''),
        },
        { Bucket: 'cleanup-original', Key: `avatars/${user.id}.jpg` },
      ])
    )
    const client = s3Mock.commandCalls(DeleteObjectCommand)[0]
      .thisValue as S3Client
    expect(await client.config.credentials()).toMatchObject({
      accessKeyId: 'rotated-access',
      secretAccessKey: 'rotated-secret',
    })
    expect(localDelete).not.toHaveBeenCalled()
    expect(await prisma.storageDeletion.count()).toBe(0)
  })

  it('treats a missing S3 key as success but keeps a missing bucket for recovery', async () => {
    await cleanupConfig('s3')
    const user = await cleanupAccount()
    await cleanup.deleteAccountWithStorageCleanup(
      'admin',
      user.id,
      'users.delete'
    )
    s3Mock
      .on(DeleteObjectCommand)
      .rejects(
        Object.assign(new Error('bucket unavailable'), { name: 'NoSuchBucket' })
      )
    const [first] = await cleanup.claimStorageDeletions()
    expect(await cleanup.processStorageDeletion(first)).toBe(false)
    expect(await prisma.storageDeletion.count()).toBe(1)
    await prisma.storageDeletion.updateMany({
      data: { availableAt: new Date(0) },
    })
    s3Mock
      .on(DeleteObjectCommand)
      .rejects(Object.assign(new Error('key absent'), { name: 'NoSuchKey' }))
    const [second] = await cleanup.claimStorageDeletions()
    expect(await cleanup.processStorageDeletion(second)).toBe(true)
    expect(await prisma.storageDeletion.count()).toBe(0)
  })

  it('cleans owned legacy avatars locally without deriving paths from external images', async () => {
    const user = await cleanupAccount()
    const legacy = `public/avatars/${user.id}.jpg`
    await new LocalStorage().uploadFile(
      Buffer.from('legacy avatar'),
      legacy,
      'image/jpeg'
    )
    cleanupPaths.add(legacy)
    await prisma.user.update({
      where: { id: user.id },
      data: {
        image: `/avatars/${user.id}.jpg`,
        avatarStoragePath: null,
        avatarStorageTarget: Prisma.DbNull,
      },
    })
    await cleanup.deleteAccountWithStorageCleanup(
      'admin',
      user.id,
      'users.delete'
    )
    const queued = await prisma.storageDeletion.findMany()
    expect(queued).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: legacy, provider: 'local' }),
      ])
    )
    await cleanupConfig('s3')
    expect(
      await Promise.all(
        (await cleanup.claimStorageDeletions()).map(
          cleanup.processStorageDeletion
        )
      )
    ).toEqual([true])
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0)
    await expect(readFile(legacy)).rejects.toMatchObject({ code: 'ENOENT' })
    const external = await cleanupAccount()
    await prisma.user.update({
      where: { id: external.id },
      data: { image: '/api/avatars/another-user.jpg' },
    })
    await cleanup.deleteAccountWithStorageCleanup(
      'admin',
      external.id,
      'users.delete'
    )
    expect(
      (await prisma.storageDeletion.findMany()).map((job) => job.path)
    ).toEqual([`uploads/avatars/${external.id}.jpg`])
    const oldHttpAvatar = await cleanupAccount()
    await prisma.user.update({
      where: { id: oldHttpAvatar.id },
      data: {
        image: `http://legacy-s3.example/avatars/${oldHttpAvatar.id}.jpg`,
        avatarStoragePath: null,
        avatarStorageTarget: Prisma.DbNull,
      },
    })
    await cleanup.deleteAccountWithStorageCleanup(
      'admin',
      oldHttpAvatar.id,
      'users.delete'
    )
    expect(
      await prisma.storageDeletion.findMany({
        where: { ownerId: oldHttpAvatar.id },
      })
    ).toEqual([
      expect.objectContaining({
        path: `uploads/avatars/${oldHttpAvatar.id}.jpg`,
        provider: 'unknown',
      }),
    ])
  })

  it('deletes files and published avatars from their original local backend after a switch to S3', async () => {
    const user = await cleanupAccount()
    const file = await cleanupFile(user.id)
    const avatarPath = user.avatarStoragePath!
    for (const path of [file.path, avatarPath]) {
      await new LocalStorage().uploadFile(
        Buffer.from('original local bytes'),
        path,
        'text/plain'
      )
      cleanupPaths.add(path)
    }
    await cleanupConfig('s3')
    await cleanup.deleteAccountWithStorageCleanup(
      'admin',
      user.id,
      'users.delete'
    )
    const jobs = await cleanup.claimStorageDeletions()
    expect(jobs.every((job) => job.provider === 'local')).toBe(true)
    expect(await Promise.all(jobs.map(cleanup.processStorageDeletion))).toEqual(
      [true, true]
    )
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0)
    for (const path of [file.path, avatarPath])
      await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps each object target when one account uploaded into different buckets', async () => {
    const config = await cleanupConfig('s3')
    const user = await cleanupAccount()
    const original = await cleanupFile(user.id)
    config.settings.general.storage.s3.bucket = 'second-bucket'
    await prisma.config.update({
      where: { key: 'flare_config' },
      data: { value: config },
    })
    const second = await cleanupFile(user.id)
    await cleanup.deleteAccountWithStorageCleanup(
      'admin',
      user.id,
      'users.delete'
    )
    s3Mock.on(DeleteObjectCommand).resolves({})
    await Promise.all(
      (await cleanup.claimStorageDeletions()).map(
        cleanup.processStorageDeletion
      )
    )
    expect(
      s3Mock.commandCalls(DeleteObjectCommand).map((call) => call.args[0].input)
    ).toEqual([
      { Bucket: 'second-bucket', Key: second.path.replace(/^uploads\//, '') },
    ])
    const retained = await prisma.storageDeletion.findMany()
    expect(retained.map((job) => job.path).sort()).toEqual(
      [original.path, user.avatarStoragePath!].sort()
    )
    expect(
      retained.every((job) => job.lastError?.includes('Storage target changed'))
    ).toBe(true)
  })

  it('retains unknown historical provenance without deleting bytes from a guessed target', async () => {
    const user = await cleanupAccount()
    const file = await cleanupFile(user.id)
    await prisma.file.update({
      where: { id: file.id },
      data: { storageTarget: Prisma.DbNull },
    })
    await prisma.user.update({
      where: { id: user.id },
      data: {
        image: `https://old-bucket.example/avatars/${user.id}.jpg`,
        avatarStoragePath: null,
        avatarStorageTarget: Prisma.DbNull,
      },
    })
    await new LocalStorage().uploadFile(
      Buffer.from('unverified local bytes'),
      file.path,
      'text/plain'
    )
    cleanupPaths.add(file.path)
    await cleanupConfig('s3')
    const remove = vi.spyOn(LocalStorage.prototype, 'deleteFile')
    await cleanup.deleteAccountWithStorageCleanup(
      'admin',
      user.id,
      'users.delete'
    )
    const jobs = await cleanup.claimStorageDeletions()
    expect(jobs.map((job) => job.provider)).toEqual(['unknown', 'unknown'])
    expect(await Promise.all(jobs.map(cleanup.processStorageDeletion))).toEqual(
      [false, false]
    )
    expect(remove).not.toHaveBeenCalled()
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0)
    expect((await readFile(file.path)).toString()).toBe(
      'unverified local bytes'
    )
    expect(
      (await prisma.storageDeletion.findMany()).every((job) =>
        job.lastError?.includes('Storage provenance is unknown')
      )
    ).toBe(true)
    // An operator verifies the original object and records only that known job.
    await prisma.storageDeletion.updateMany({
      where: { path: file.path },
      data: {
        provider: 'local',
        target: { provider: 'local' },
        availableAt: new Date(0),
      },
    })
    const [verified] = await cleanup.claimStorageDeletions()
    expect(await cleanup.processStorageDeletion(verified)).toBe(true)
    expect(await prisma.storageDeletion.count()).toBe(1)
  })

  it('never claims or acknowledges an unsettled upload intent after its owner is removed', async () => {
    const user = await cleanupAccount()
    const intent = await prisma.storageDeletion.create({
      data: {
        ownerId: user.id,
        path: `${cleanupPrefix}/in-flight.jpg`,
        provider: 'local',
        target: { provider: 'local' },
        writePending: true,
      },
    })
    await cleanup.deleteAccountWithStorageCleanup(
      'admin',
      user.id,
      'users.delete'
    )
    const claimed = await cleanup.claimStorageDeletions()
    expect(claimed.map((job) => job.id)).not.toContain(intent.id)
    await Promise.all(claimed.map(cleanup.processStorageDeletion))
    await prisma.storageDeletion.update({
      where: { id: intent.id },
      data: {
        status: 'processing',
        leaseId: 'stale-upload',
        leaseUntil: new Date(0),
      },
    })
    expect(await cleanup.claimStorageDeletions()).toEqual([])
    expect(await prisma.storageDeletion.count()).toBe(1)
    // After all old writers stop, operator reconciliation can safely release it.
    await prisma.storageDeletion.update({
      where: { id: intent.id },
      data: { writePending: false },
    })
    const [released] = await cleanup.claimStorageDeletions()
    expect(await cleanup.processStorageDeletion(released)).toBe(true)
    expect(await prisma.storageDeletion.count()).toBe(0)
  })

  it('retains malformed or contradictory cleanup targets without touching either backend', async () => {
    await prisma.storageDeletion.createMany({
      data: [
        {
          ownerId: 'retired',
          path: 'uploads/contradictory.txt',
          provider: 's3',
          target: { provider: 'local' },
        },
        {
          ownerId: 'retired',
          path: 'uploads/unverified.txt',
          provider: 'local',
          target: {},
        },
      ],
    })
    const remove = vi.spyOn(LocalStorage.prototype, 'deleteFile')
    expect(
      await Promise.all(
        (await cleanup.claimStorageDeletions()).map(
          cleanup.processStorageDeletion
        )
      )
    ).toEqual([false, false])
    expect(remove).not.toHaveBeenCalled()
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0)
    expect(await prisma.storageDeletion.count()).toBe(2)
  })

  it('queues and cascades a 150,000-file account with a single database-side copy', async () => {
    const user = await cleanupAccount()
    await prisma.$executeRaw`
      INSERT INTO "File" (id, name, "urlPath", "mimeType", size, "userId", path, "storageTarget")
      SELECT ${user.id} || '-' || i, 'large-fixture.txt', '/' || ${user.id} || '/' || i,
        'text/plain', 1, ${user.id}, 'uploads/' || ${user.id} || '/' || i,
        '{"provider":"local"}'::jsonb
      FROM generate_series(1, 150000) AS i
    `
    const start = Date.now()
    await cleanup.deleteAccountWithStorageCleanup(
      'admin',
      user.id,
      'users.delete'
    )
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(0)
    expect(await prisma.file.count({ where: { userId: user.id } })).toBe(0)
    expect(
      await prisma.storageDeletion.count({ where: { ownerId: user.id } })
    ).toBe(150001)
    expect(Date.now() - start).toBeLessThan(
      cleanup.ACCOUNT_DELETION_TRANSACTION_MS
    )
  }, 180_000)

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
      for (const sql of readFileSync(
        'prisma/migrations/20260926020000_durable_account_cleanup/migration.sql',
        'utf8'
      )
        .split(';')
        .map((sql) => sql.trim())
        .filter(Boolean))
        await legacy.$executeRawUnsafe(sql)
      await legacy.$executeRawUnsafe(`
        INSERT INTO "StorageDeletion"
          (id, "ownerId", path, provider, target, status, "leaseId", "leaseUntil", "updatedAt")
        VALUES ('old-job', 'deleted-owner', 'uploads/old.txt', 's3',
          '{"bucket":"previously-guessed"}'::jsonb, 'processing', 'old-lease', NOW() + INTERVAL '1 hour', NOW())
      `)
      // Split only statement terminators: the diagnostic string has a semicolon.
      const provenanceMigration = readFileSync(
        'prisma/migrations/20260926030000_storage_provenance/migration.sql',
        'utf8'
      )
      for (const sql of provenanceMigration
        .split(/;\s*(?:\n|$)/)
        .map((sql) => sql.trim())
        .filter(Boolean))
        await legacy.$executeRawUnsafe(sql)
      expect(
        await legacy.$queryRawUnsafe('SELECT "storageTarget" FROM "File"')
      ).toEqual([{ storageTarget: null }])
      expect(
        await legacy.$queryRawUnsafe(
          'SELECT "avatarStoragePath", "avatarStorageTarget" FROM "User"'
        )
      ).toEqual([
        { avatarStoragePath: null, avatarStorageTarget: null },
        { avatarStoragePath: null, avatarStorageTarget: null },
      ])
      expect(
        await legacy.storageDeletion.findUnique({ where: { id: 'old-job' } })
      ).toMatchObject({
        ownerId: 'deleted-owner',
        path: 'uploads/old.txt',
        provider: 'unknown',
        target: {
          previousProvider: 's3',
          previousTarget: { bucket: 'previously-guessed' },
        },
        status: 'pending',
        leaseId: null,
        leaseUntil: null,
        writePending: false,
        lastError: expect.stringContaining('Storage provenance is unknown'),
      })
    } finally {
      await legacy.$disconnect()
      await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`)
    }
  })
})
