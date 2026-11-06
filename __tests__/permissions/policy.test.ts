import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PERMISSIONS,
  resolvePermissions,
} from '@/lib/permissions/catalog'
import {
  EVERYONE_POSITION,
  EVERYONE_ROLE,
  ROLE_DEFAULTS,
  ROLE_LIMITS,
  canGrantPermissions,
  canGrantRole,
  canManageRole,
  highestRolePosition,
  isEveryoneRole,
  roleCanHold,
  userManagementRefusal,
} from '@/lib/permissions/policy'
import { roleCreateSchema, roleUpdateSchema } from '@/lib/permissions/schema'

const everyone = {
  systemKey: EVERYONE_ROLE,
  position: EVERYONE_POSITION,
  permissions: [...DEFAULT_PERMISSIONS] as string[],
}
function account(
  id: string,
  roles: { position: number; permissions: string[] }[]
) {
  const all = [...roles, everyone]
  return { id, roles: all, permissions: resolvePermissions(all) }
}
const manager = account('manager', [
  {
    position: 50,
    permissions: ['users.update', 'users.roles', 'roles.manage'],
  },
])
const administrator = account('admin', [
  { position: 100, permissions: ['administrator'] },
])

describe('role policy', () => {
  it('names Everyone once and keeps Administrator off it', () => {
    expect(isEveryoneRole(everyone)).toBe(true)
    expect(isEveryoneRole({ systemKey: null })).toBe(false)
    expect(isEveryoneRole(undefined)).toBe(false)
    expect(roleCanHold(everyone, 'administrator')).toBe(false)
    expect(roleCanHold(everyone, 'invites.create')).toBe(true)
    expect(roleCanHold({ systemKey: null }, 'administrator')).toBe(true)
    expect(roleCanHold(undefined, 'administrator')).toBe(true)
  })

  it('lets delegated managers change only lower roles without Administrator', () => {
    expect(highestRolePosition(manager)).toBe(50)
    expect(highestRolePosition(undefined)).toBe(0)
    expect(canManageRole(manager, { position: 49, permissions: [] })).toBe(true)
    expect(canManageRole(manager, { position: 50, permissions: [] })).toBe(
      false
    )
    expect(
      canManageRole(manager, { position: 10, permissions: ['administrator'] })
    ).toBe(false)
    expect(
      canManageRole(administrator, {
        position: 1_000_000,
        permissions: ['administrator'],
      })
    ).toBe(true)
    expect(canManageRole(undefined, { position: 1, permissions: [] })).toBe(
      false
    )
  })

  it('grants only held permissions, and a stored key Flare does not know is never held', () => {
    expect(canGrantPermissions(manager, ['users.update', 'files.read'])).toBe(
      true
    )
    expect(canGrantPermissions(manager, ['users.delete'])).toBe(false)
    expect(canGrantPermissions(manager, ['administrator'])).toBe(false)
    expect(canGrantPermissions(manager, ['legacy.permission'])).toBe(false)
    expect(
      canGrantPermissions(administrator, ['administrator', 'legacy.permission'])
    ).toBe(true)
    expect(canGrantPermissions(undefined, ['files.read'])).toBe(false)
  })

  it('never offers Everyone as a role to grant, even to administrators', () => {
    const lower = {
      systemKey: null,
      position: 10,
      permissions: ['users.update'],
    }
    expect(canGrantRole(manager, lower)).toBe(true)
    expect(canGrantRole(manager, { ...lower, position: 50 })).toBe(false)
    expect(
      canGrantRole(manager, { ...lower, permissions: ['settings.storage'] })
    ).toBe(false)
    expect(canGrantRole(administrator, everyone)).toBe(false)
    expect(canGrantRole(manager, everyone)).toBe(false)
  })

  it('manages accounts by their resolved permissions, as the server does', () => {
    // A key from another Flare version grants nothing, so it can't block management.
    const legacy = account('legacy', [
      { position: 10, permissions: ['users.update', 'legacy.permission'] },
    ])
    expect(legacy.permissions).not.toContain('legacy.permission')
    expect(userManagementRefusal(manager, legacy)).toBeNull()

    const storage = account('storage', [
      { position: 10, permissions: ['settings.storage'] },
    ])
    expect(userManagementRefusal(manager, storage)).toBe(
      'You can only manage accounts whose permissions you already have'
    )
    const rank = 'You can only manage accounts below your highest role'
    expect(userManagementRefusal(manager, manager)).toBe(rank)
    expect(
      userManagementRefusal(
        manager,
        account('peer', [{ position: 50, permissions: [] }])
      )
    ).toBe(rank)
    expect(userManagementRefusal(manager, administrator)).toBe(rank)
    expect(userManagementRefusal(undefined, legacy)).toBe(rank)
    expect(userManagementRefusal(administrator, administrator)).toBeNull()
    expect(userManagementRefusal(administrator, storage)).toBeNull()
  })

  it('validates roles with the limits and defaults the editor uses', () => {
    const name = 'n'.repeat(ROLE_LIMITS.name)
    expect(roleCreateSchema.parse({ name })).toEqual({
      name,
      ...ROLE_DEFAULTS,
      permissions: [],
    })
    expect(roleCreateSchema.safeParse({ name: `${name}n` }).success).toBe(false)
    expect(
      roleCreateSchema.safeParse({
        name: 'Role',
        description: 'd'.repeat(ROLE_LIMITS.description),
      }).success
    ).toBe(true)
    expect(
      roleCreateSchema.safeParse({
        name: 'Role',
        description: 'd'.repeat(ROLE_LIMITS.description + 1),
      }).success
    ).toBe(false)
    for (const [position, valid] of [
      [ROLE_LIMITS.position.min, true],
      [ROLE_LIMITS.position.max, true],
      [ROLE_LIMITS.position.max + 1, false],
      [EVERYONE_POSITION, false],
    ] as const)
      expect(
        roleCreateSchema.safeParse({ name: 'Role', position }).success
      ).toBe(valid)
    // Only Everyone's own position passes an update; the role service refuses it elsewhere.
    expect(roleUpdateSchema.parse({ position: EVERYONE_POSITION })).toEqual({
      position: EVERYONE_POSITION,
    })
    expect(
      roleUpdateSchema.safeParse({ position: ROLE_LIMITS.position.max + 1 })
        .success
    ).toBe(false)
  })
})
