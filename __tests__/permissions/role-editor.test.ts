import { describe, expect, it } from 'vitest'

import {
  canEditRole,
  maxRolePosition,
  rolePositionProblem,
} from '@/components/roles/role-manager'

import type { Access } from '@/lib/permissions/policy'

const manager: Access = {
  roles: [{ position: 5 }],
  permissions: ['roles.manage', 'files.read'],
}
const administrator: Access = {
  roles: [{ position: 100 }],
  permissions: ['administrator'],
}
const role = (position: number, permissions: string[] = []) => ({
  id: `role-${position}`,
  name: `Role ${position}`,
  description: '',
  color: '#64748b',
  position,
  permissions,
  systemKey: null,
  memberCount: 0,
})

describe('role editor', () => {
  it('judges a new role as it starts, so its draft never locks the editor', () => {
    expect(canEditRole(manager, undefined)).toBe(true)
    expect(
      canEditRole({ roles: [{ position: 1 }], permissions: [] }, undefined)
    ).toBe(false)
  })

  it('judges a saved role by what is stored', () => {
    expect(canEditRole(manager, role(4))).toBe(true)
    expect(canEditRole(manager, role(5))).toBe(false)
    expect(canEditRole(manager, role(1, ['administrator']))).toBe(false)
    expect(canEditRole(administrator, role(100, ['administrator']))).toBe(true)
  })

  it('explains on the position field which positions can be saved', () => {
    expect(maxRolePosition(manager)).toBe(4)
    expect(rolePositionProblem(manager, 4)).toBeNull()
    for (const position of [5, 9, 0, 2.5, Number.NaN])
      expect(rolePositionProblem(manager, position)).toBe(
        'Use a whole number from 1 to 4, below your highest role.'
      )
    expect(maxRolePosition(administrator)).toBe(1_000_000)
    expect(rolePositionProblem(administrator, 1_000_000)).toBeNull()
    expect(rolePositionProblem(administrator, 1_000_001)).toMatch(
      /^Use a whole number from 1 to 1\D?000\D?000\.$/
    )
  })
})
