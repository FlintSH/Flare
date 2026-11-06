/**
 * Who may change roles and accounts, shared by the API and the dashboard so
 * both apply one rule. No server imports.
 */
import { type Permission, type RoleSummary, hasPermission } from './catalog'

/** The `systemKey` of the role every account holds without being assigned it. */
export const EVERYONE_ROLE = 'everyone'
/** Everyone ranks below every role people create. */
export const EVERYONE_POSITION = 0

export function isEveryoneRole(
  role: Pick<RoleSummary, 'systemKey'> | null | undefined
): boolean {
  return role?.systemKey === EVERYONE_ROLE
}

/** Everyone never holds Administrator: every account would. */
export function roleCanHold(
  role: Pick<RoleSummary, 'systemKey'> | null | undefined,
  permission: string
): boolean {
  return permission !== 'administrator' || !isEveryoneRole(role)
}

export const ROLE_LIMITS = {
  name: 50,
  description: 300,
  position: { min: 1, max: 1_000_000 },
} as const

/** What a new role starts with when a field is left out. */
export const ROLE_DEFAULTS = {
  description: '',
  color: '#64748b',
  position: ROLE_LIMITS.position.min,
} as const

/** An account's roles and the permissions they resolve to, as sessions carry them. */
export interface Access {
  roles: readonly Pick<RoleSummary, 'position'>[]
  permissions: readonly Permission[]
}

export function highestRolePosition(
  subject: Pick<Access, 'roles'> | null | undefined
): number {
  return Math.max(0, ...(subject?.roles ?? []).map((role) => role.position))
}

/** Below Administrator, only roles strictly under the actor's highest role and without Administrator. */
export function canManageRole(
  actor: Access | null | undefined,
  role: Pick<RoleSummary, 'position' | 'permissions'>
): boolean {
  return (
    hasPermission(actor, 'administrator') ||
    (role.position < highestRolePosition(actor) &&
      !role.permissions.includes('administrator'))
  )
}

/** Below Administrator, only permissions the actor holds, and never Administrator itself. */
export function canGrantPermissions(
  actor: Access | null | undefined,
  permissions: readonly string[]
): boolean {
  return (
    hasPermission(actor, 'administrator') ||
    permissions.every(
      (permission) =>
        permission !== 'administrator' &&
        Boolean(actor?.permissions.includes(permission as Permission))
    )
  )
}

/** Whether the actor may give this role to an account or an invite, or take it away. */
export function canGrantRole(
  actor: Access | null | undefined,
  role: Pick<RoleSummary, 'position' | 'permissions' | 'systemKey'>
): boolean {
  return (
    !isEveryoneRole(role) &&
    canManageRole(actor, role) &&
    canGrantPermissions(actor, role.permissions)
  )
}

/**
 * Why the actor may not manage the target's account, or null when it may.
 * Pass both accounts' resolved permissions: a stored key Flare doesn't know
 * grants nothing, so it doesn't count either.
 */
export function userManagementRefusal(
  actor: (Access & { id: string }) | null | undefined,
  target: Access & { id: string }
): string | null {
  if (hasPermission(actor, 'administrator')) return null
  if (
    !actor ||
    actor.id === target.id ||
    hasPermission(target, 'administrator') ||
    highestRolePosition(actor) <= highestRolePosition(target)
  )
    return 'You can only manage accounts below your highest role'
  // Resetting a lower account’s credentials must not transfer authority the
  // actor could not grant directly. Hierarchy alone does not imply a subset.
  if (
    target.permissions.some((permission) => !hasPermission(actor, permission))
  )
    return 'You can only manage accounts whose permissions you already have'
  return null
}
