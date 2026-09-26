import { describe, expect, it } from 'vitest'

import {
  ALL_PERMISSIONS,
  DEFAULT_PERMISSIONS,
  PERMISSION_GROUPS,
  hasPermission,
  resolvePermissions,
} from '@/lib/permissions/catalog'
import { roleCreateSchema, roleUpdateSchema } from '@/lib/permissions/schema'

describe('role permission contracts', () => {
  it('has a unique, discoverable catalog with a conservative Everyone default', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length)
    expect(
      PERMISSION_GROUPS.every((group) =>
        group.permissions.every(
          (permission) => permission.label && permission.description
        )
      )
    ).toBe(true)
    expect(DEFAULT_PERMISSIONS).toContain('files.upload')
    expect(DEFAULT_PERMISSIONS).not.toContain('administrator')
    expect(
      DEFAULT_PERMISSIONS.some((permission) =>
        /^(users|content|settings|roles)\./.test(permission)
      )
    ).toBe(false)
  })

  it('combines roles additively and fails closed for unknown authority', () => {
    expect(
      resolvePermissions([
        { permissions: ['files.read', 'unknown'] },
        { permissions: ['files.upload', 'files.read'] },
      ])
    ).toEqual(['files.read', 'files.upload'])
    expect(hasPermission(undefined, 'files.read')).toBe(false)
    expect(hasPermission({ permissions: [] }, 'files.read')).toBe(false)
    expect(hasPermission({ role: 'ADMIN' } as object, 'files.read')).toBe(false)
    expect(resolvePermissions([{ permissions: ['administrator'] }])).toEqual(
      ALL_PERMISSIONS
    )
    expect(
      hasPermission({ permissions: ['administrator'] }, 'settings.security')
    ).toBe(true)
  })

  it.each([
    { name: '' },
    { name: 'a'.repeat(51) },
    { name: 'Good', permissions: ['unknown'] },
    { name: 'Good', permissions: ['files.read', 'files.read'] },
    { name: 'Good', position: 0 },
    { name: 'Good', position: 1.5 },
    { name: 'Good', color: 'red' },
    { name: 'Good', systemKey: 'administrator' },
    { name: 'Good', description: 'a'.repeat(301) },
  ])('rejects invalid role input %j', (input) => {
    expect(roleCreateSchema.safeParse(input).success).toBe(false)
  })

  it('allows partial updates without silently replacing omitted values', () => {
    expect(roleUpdateSchema.parse({ color: '#123abc' })).toEqual({
      color: '#123abc',
    })
    expect(roleUpdateSchema.safeParse({}).success).toBe(false)
  })
})
