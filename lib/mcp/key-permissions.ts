import type { Prisma } from '@prisma/client'

import type { Permission } from '@/lib/permissions/catalog'
import { EVERYONE_ROLE } from '@/lib/permissions/policy'

/**
 * The permissions that hold the keys to the instance: who administers it,
 * how people get in (registration, OIDC, the MCP switches), and where
 * account mail goes. No MCP call grants one to anybody (design 3.16 item 2).
 * They are a closed set: an account manages only accounts whose permissions
 * it holds, and grants only permissions it holds, so nobody without them
 * reaches someone who has them.
 */
export const KEY_PERMISSIONS = [
  'administrator',
  'settings.security',
  'settings.email',
] as const satisfies readonly Permission[]

/**
 * Whether a role's stored permissions, or an account's resolved ones, hold a
 * key permission. `administrator` is one of them and stands for all of
 * them, as it does in `hasPermission`.
 */
export function holdsKeyPermission(permissions: readonly string[]): boolean {
  return permissions.some((permission) =>
    (KEY_PERMISSIONS as readonly string[]).includes(permission)
  )
}

/**
 * The key permissions `after` holds that `before` did not: what a role edit
 * adds. Keeping a grant is not adding one, and neither is taking one away.
 */
export function addedKeyPermissions(
  before: readonly string[],
  after: readonly string[]
): Permission[] {
  return KEY_PERMISSIONS.filter(
    (permission) => after.includes(permission) && !before.includes(permission)
  )
}

type Tx = Pick<Prisma.TransactionClient, 'role'>

/**
 * Whether the Everyone role holds a key permission, so every account, and
 * every account made from now on, has it. `roleCanHold` keeps
 * `administrator` off Everyone, but `settings.security` and `settings.email`
 * can be given to it in the browser. Call with `lockRoleChanges` held, in
 * the transaction that acts on the answer.
 */
export async function everyoneHoldsKey(tx: Tx): Promise<boolean> {
  const everyone = await tx.role.findUnique({
    where: { systemKey: EVERYONE_ROLE },
    select: { permissions: true },
  })
  return holdsKeyPermission(everyone?.permissions ?? [])
}

/**
 * Whether any of these roles holds a key permission: what assigning them to
 * an account, or attaching them to an invite, would hand over. Only the
 * roles' own permissions count; an ID that names no role adds nothing (the
 * assignment rules refuse it). Call with `lockRoleChanges` held.
 *
 * What an account or an invite ends up with is these roles and Everyone's.
 * Where that matters (a new account, an invite's link) ask `everyoneHoldsKey`
 * too, or use `grantsKey` with `keyHoldingRoles`.
 */
export async function rolesGrantKey(
  tx: Tx,
  roleIds: readonly string[]
): Promise<boolean> {
  if (!roleIds.length) return false
  const roles = await tx.role.findMany({
    where: { id: { in: [...new Set(roleIds)] } },
    select: { permissions: true },
  })
  return roles.some((role) => holdsKeyPermission(role.permissions))
}

/** Which roles hold a key permission, read once for checking many invites. */
export type KeyHoldingRoles = {
  /** Everyone holds one, so every invite's effective permissions do. */
  everyone: boolean
  /** The other roles that hold one. */
  roleIds: ReadonlySet<string>
}

/** Every role that holds a key permission. Call with `lockRoleChanges` held. */
export async function keyHoldingRoles(tx: Tx): Promise<KeyHoldingRoles> {
  const roles = await tx.role.findMany({
    select: { id: true, permissions: true, systemKey: true },
  })
  const holding = roles.filter((role) => holdsKeyPermission(role.permissions))
  return {
    everyone: holding.some((role) => role.systemKey === EVERYONE_ROLE),
    roleIds: new Set(
      holding
        .filter((role) => role.systemKey !== EVERYONE_ROLE)
        .map((role) => role.id)
    ),
  }
}

/**
 * Whether an invite or account with these roles would hold a key permission
 * once Everyone's are added: its effective permissions, as `keyHoldingRoles`
 * read them. A role-less invite holds exactly Everyone's.
 */
export function grantsKey(
  holding: KeyHoldingRoles,
  roleIds: readonly string[]
): boolean {
  return holding.everyone || roleIds.some((id) => holding.roleIds.has(id))
}
