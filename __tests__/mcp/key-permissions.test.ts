import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  KEY_PERMISSIONS,
  addedKeyPermissions,
  everyoneHoldsKey,
  grantsKey,
  holdsKeyPermission,
  keyHoldingRoles,
  rolesGrantKey,
} from '@/lib/mcp/key-permissions'
import { resolveAccount } from '@/lib/mcp/moderation'
import { ToolError } from '@/lib/mcp/tool'
import { ALL_PERMISSIONS } from '@/lib/permissions/catalog'
import { roleCanHold } from '@/lib/permissions/policy'

const db = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { user: { findUnique: db.findUnique, findMany: db.findMany } },
}))

beforeEach(() => vi.resetAllMocks())

describe('the key permissions', () => {
  it('are administrator, Security settings and Email settings', () => {
    expect(KEY_PERMISSIONS).toEqual([
      'administrator',
      'settings.security',
      'settings.email',
    ])
    for (const permission of KEY_PERMISSIONS)
      expect(ALL_PERMISSIONS).toContain(permission)
  })

  it('are held by any list that has one of them, administrator included', () => {
    for (const permission of KEY_PERMISSIONS)
      expect(holdsKeyPermission(['files.read', permission])).toBe(true)
    expect(
      holdsKeyPermission(
        ALL_PERMISSIONS.filter(
          (permission) =>
            !(KEY_PERMISSIONS as readonly string[]).includes(permission)
        )
      )
    ).toBe(false)
    expect(holdsKeyPermission([])).toBe(false)
  })

  it('can reach Everyone, except administrator, which is why Everyone is checked', () => {
    const everyone = { systemKey: 'everyone' }
    expect(roleCanHold(everyone, 'administrator')).toBe(false)
    expect(roleCanHold(everyone, 'settings.security')).toBe(true)
    expect(roleCanHold(everyone, 'settings.email')).toBe(true)
  })

  it('count as added only when a change gives a key the role did not have', () => {
    expect(addedKeyPermissions([], ['settings.email', 'files.read'])).toEqual([
      'settings.email',
    ])
    // Keeping a grant, or taking one away, adds nothing.
    expect(
      addedKeyPermissions(['settings.security'], ['settings.security'])
    ).toEqual([])
    expect(addedKeyPermissions(['administrator'], [])).toEqual([])
    expect(
      addedKeyPermissions(
        ['settings.email'],
        ['settings.email', 'administrator', 'settings.security']
      )
    ).toEqual(['administrator', 'settings.security'])
  })
})

describe('reading roles for the key permissions', () => {
  const roles = [
    { id: 'everyone', systemKey: 'everyone', permissions: ['files.read'] },
    { id: 'admin', systemKey: null, permissions: ['administrator'] },
    { id: 'mail', systemKey: null, permissions: ['settings.email'] },
    { id: 'members', systemKey: null, permissions: ['users.create'] },
  ]
  const tx = (rows = roles) => ({
    role: {
      findUnique: vi.fn(
        async ({ where }: { where: { systemKey: string } }) =>
          rows.find((role) => role.systemKey === where.systemKey) ?? null
      ),
      findMany: vi.fn(async ({ where }: { where?: { id: { in: string[] } } }) =>
        rows.filter((role) => !where || where.id.in.includes(role.id))
      ),
    },
  })
  const holding = (everyone: string[]) => [
    { ...roles[0], permissions: everyone },
    ...roles.slice(1),
  ]

  it('says whether Everyone holds one', async () => {
    expect(await everyoneHoldsKey(tx() as never)).toBe(false)
    expect(
      await everyoneHoldsKey(tx(holding(['settings.security'])) as never)
    ).toBe(true)
    // An instance without an Everyone role yet holds nothing for everyone.
    expect(await everyoneHoldsKey(tx([]) as never)).toBe(false)
  })

  it('says whether assigning or attaching roles would hand one over, by their own permissions', async () => {
    const client = tx()
    expect(await rolesGrantKey(client as never, ['members'])).toBe(false)
    expect(await rolesGrantKey(client as never, ['members', 'mail'])).toBe(true)
    expect(await rolesGrantKey(client as never, ['admin'])).toBe(true)
    expect(await rolesGrantKey(client as never, ['no-such-role'])).toBe(false)
    expect(client.role.findMany).toHaveBeenLastCalledWith({
      where: { id: { in: ['no-such-role'] } },
      select: { permissions: true },
    })
    // Nothing to read for no roles.
    client.role.findMany.mockClear()
    expect(await rolesGrantKey(client as never, [])).toBe(false)
    expect(client.role.findMany).not.toHaveBeenCalled()
  })

  it("counts Everyone's permissions in what an invite or new account would hold", async () => {
    const plain = await keyHoldingRoles(tx() as never)
    expect(plain).toEqual({
      everyone: false,
      roleIds: new Set(['admin', 'mail']),
    })
    expect(grantsKey(plain, [])).toBe(false)
    expect(grantsKey(plain, ['members'])).toBe(false)
    expect(grantsKey(plain, ['members', 'mail'])).toBe(true)
    // Once Everyone holds one, every invite does, a role-less one included.
    const everyone = await keyHoldingRoles(
      tx(holding(['settings.email'])) as never
    )
    expect(everyone.everyone).toBe(true)
    expect(everyone.roleIds.has('everyone')).toBe(false)
    expect(grantsKey(everyone, [])).toBe(true)
    expect(grantsKey(everyone, ['members'])).toBe(true)
  })
})

describe('resolveAccount', () => {
  const sam = { id: 'user-sam', name: 'Sam', email: 'sam@example.com' }
  const other = { id: 'user-other', name: 'Sam', email: 'other@example.com' }
  const failure = (promise: Promise<unknown>) =>
    promise.then(
      () => {
        throw new Error('Expected a refusal')
      },
      (error: unknown) => error as ToolError
    )

  it('finds an account by its user ID first, and reads nothing else', async () => {
    db.findUnique.mockResolvedValue(sam)
    expect(await resolveAccount('  user-sam ')).toBe(sam)
    expect(db.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-sam' },
      select: expect.objectContaining({ id: true, name: true, email: true }),
    })
    expect(db.findMany).not.toHaveBeenCalled()
  })

  it('then by email, in any letter case', async () => {
    db.findUnique.mockResolvedValue(null)
    db.findMany.mockResolvedValueOnce([sam])
    expect(await resolveAccount('SAM@example.com')).toBe(sam)
    expect(db.findMany).toHaveBeenCalledWith({
      where: { email: { equals: 'SAM@example.com', mode: 'insensitive' } },
      select: expect.objectContaining({ id: true }),
      take: 2,
    })
  })

  it('then by name, refusing a name more than one account has', async () => {
    db.findUnique.mockResolvedValue(null)
    db.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([sam])
    expect(await resolveAccount('sam')).toBe(sam)
    db.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([sam, other])
    const refused = await failure(resolveAccount('Sam'))
    expect(refused).toBeInstanceOf(ToolError)
    expect(refused.message).toBe(
      'More than one account matches. Name the account by its user ID instead.'
    )
  })

  it("lets an email win over a name that copies it, so nobody's chosen name stands for another account", async () => {
    db.findUnique.mockResolvedValue(null)
    // Someone named themselves after Sam's address; the address is Sam's.
    db.findMany.mockResolvedValueOnce([sam])
    expect(await resolveAccount('sam@example.com')).toBe(sam)
    expect(db.findMany).toHaveBeenCalledTimes(1)
  })

  it('refuses what matches nothing, naming nobody', async () => {
    db.findUnique.mockResolvedValue(null)
    db.findMany.mockResolvedValue([])
    const refused = await failure(resolveAccount('nobody'))
    expect(refused.message).toBe(
      'No account has that user ID, name or email. Check it, or use the user ID.'
    )
    expect((await failure(resolveAccount('   '))).message).toMatch(
      /^No account has/
    )
  })
})
