import { Prisma } from '@prisma/client'

import { readConfig } from '@/lib/config'
import { oidcSubjectPrefix } from '@/lib/config/oidc'
import { prisma } from '@/lib/database/prisma'
import { getEmailConfig, getEmailConfigForUpdate } from '@/lib/email/config'
import {
  type EmailPolicyUser,
  hasDurableEmailAccess,
  requiresEmailVerification,
} from '@/lib/email/policy'
import type { EmailConfig } from '@/lib/email/schema'
import { HttpError } from '@/lib/http/errors'

import {
  DEFAULT_PERMISSIONS,
  Permission,
  RoleSummary,
  hasPermission,
  resolvePermissions,
} from './catalog'
import {
  EVERYONE_POSITION,
  EVERYONE_ROLE,
  canGrantPermissions,
  canManageRole,
  isEveryoneRole,
  userManagementRefusal,
} from './policy'

type AccessClient = Pick<Prisma.TransactionClient, 'user' | 'role'>
export const roleSelect = {
  id: true,
  name: true,
  description: true,
  color: true,
  position: true,
  systemKey: true,
  permissions: true,
} as const
export interface UserAccess {
  roles: RoleSummary[]
  permissions: Permission[]
}

export class PermissionError extends HttpError {
  constructor(message: string, status = 403) {
    super(status, message)
    this.name = 'PermissionError'
  }
}

/** Safe for migrated instances and freshly initialized databases. Never overwrite customizations. */
export async function ensureBuiltInRoles(tx: Prisma.TransactionClient) {
  const everyone = await tx.role.upsert({
    where: { systemKey: EVERYONE_ROLE },
    update: {},
    create: {
      name: 'Everyone',
      description: 'Base permissions for every account.',
      color: '#64748b',
      position: EVERYONE_POSITION,
      permissions: [...DEFAULT_PERMISSIONS],
      systemKey: EVERYONE_ROLE,
    },
  })
  const administrator = await tx.role.upsert({
    where: { systemKey: 'administrator' },
    update: {},
    create: {
      name: 'Admin',
      description: 'Full control of this instance.',
      color: '#ef4444',
      position: 100,
      permissions: ['administrator'],
      systemKey: 'administrator',
    },
  })
  return { everyone, administrator }
}

/** The access of an account holding `assigned`, plus the role everyone holds. */
export function combineAccess(
  assigned: RoleSummary[],
  everyone: RoleSummary | null
): UserAccess {
  const roles = [
    ...assigned.filter((role) => !isEveryoneRole(role)),
    ...(everyone ? [everyone] : []),
  ].sort((a, b) => b.position - a.position || a.name.localeCompare(b.name))
  return { roles, permissions: resolvePermissions(roles) }
}

export async function getUserAccess(
  userId: string,
  tx: AccessClient = prisma
): Promise<UserAccess> {
  const [user, everyone] = await Promise.all([
    tx.user.findUnique({
      where: { id: userId },
      select: { roles: { select: roleSelect } },
    }),
    tx.role.findUnique({
      where: { systemKey: EVERYONE_ROLE },
      select: roleSelect,
    }),
  ])
  if (!user) return { roles: [], permissions: [] }
  return combineAccess(user.roles, everyone)
}

/** Batched getUserAccess for lists; missing accounts are absent from the map. */
export async function getUsersAccess(
  userIds: readonly string[],
  tx: AccessClient = prisma
): Promise<Map<string, UserAccess>> {
  if (!userIds.length) return new Map()
  const [users, everyone] = await Promise.all([
    tx.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, roles: { select: roleSelect } },
    }),
    tx.role.findUnique({
      where: { systemKey: EVERYONE_ROLE },
      select: roleSelect,
    }),
  ])
  return new Map(
    users.map((user) => [user.id, combineAccess(user.roles, everyone)])
  )
}

function canAct(
  user: EmailPolicyUser | null | undefined,
  email: EmailConfig
): user is EmailPolicyUser {
  return user != null && !requiresEmailVerification(user, email)
}

/** Recheck authority after acquiring the mutation lock, never trust a pre-lock session snapshot. */
export async function requireActorPermission(
  tx: Prisma.TransactionClient,
  userId: string,
  permission: Permission
): Promise<UserAccess> {
  const user = await tx.user.findUnique({ where: { id: userId } })
  const email = await getEmailConfigForUpdate(tx)
  if (!canAct(user, email))
    throw new PermissionError('Your account no longer has access')
  const access = await getUserAccess(userId, tx)
  if (!hasPermission(access, permission))
    throw new PermissionError('You no longer have permission for this action')
  return access
}

/**
 * What `requireActorPermission` would see for each account, read without
 * locks for display: its access, or null when it can't act. Mutations still
 * recheck under the lock.
 */
export async function getActingAccess(
  userIds: readonly string[]
): Promise<Map<string, UserAccess | null>> {
  if (!userIds.length) return new Map()
  // A constant number of reads, however many accounts are asked about.
  const [users, accessById, email] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        emailVerifiedFor: true,
        emailVerificationSource: true,
        emailExempt: true,
        createdAt: true,
      },
    }),
    getUsersAccess(userIds),
    getEmailConfig(),
  ])
  return new Map(
    userIds.map((id) => {
      const access = accessById.get(id)
      const user = users.find((candidate) => candidate.id === id)
      return [id, access && canAct(user, email) ? access : null]
    })
  )
}

export async function assertCanManageUser(
  tx: Prisma.TransactionClient,
  actorId: string,
  targetId: string
) {
  const [actor, target] = await Promise.all([
    getUserAccess(actorId, tx),
    getUserAccess(targetId, tx),
  ])
  const refusal = userManagementRefusal(
    { ...actor, id: actorId },
    { ...target, id: targetId }
  )
  if (refusal) throw new PermissionError(refusal)
}

export function assertCanManageRole(
  actor: UserAccess,
  role: Pick<RoleSummary, 'position' | 'permissions'>
) {
  if (!canManageRole(actor, role))
    throw new PermissionError(
      'You can only manage roles below your highest role'
    )
}

export function assertCanGrantPermissions(
  actor: UserAccess,
  permissions: readonly string[]
) {
  if (!canGrantPermissions(actor, permissions))
    throw new PermissionError('You can only grant permissions you already have')
}

/** Validates the entire replacement set; unchanged roles are never silently removed. */
export async function validateRoleAssignment(
  tx: Prisma.TransactionClient,
  actorId: string,
  targetId: string | null,
  roleIds: string[]
): Promise<RoleSummary[]> {
  if (new Set(roleIds).size !== roleIds.length || roleIds.length > 100)
    throw new PermissionError('Choose at most 100 distinct roles', 400)
  const actor = await requireActorPermission(tx, actorId, 'users.roles')
  if (targetId) await assertCanManageUser(tx, actorId, targetId)
  const roles = await tx.role.findMany({
    where: { id: { in: roleIds } },
    select: roleSelect,
  })
  if (roles.length !== roleIds.length || roles.some(isEveryoneRole))
    throw new PermissionError(
      'Choose existing roles; Everyone applies automatically',
      400
    )
  const current = targetId
    ? (await getUserAccess(targetId, tx)).roles.filter(
        (role) => !isEveryoneRole(role)
      )
    : []
  const changed = [
    ...roles.filter(
      (role) => !current.some((existing) => existing.id === role.id)
    ),
    ...current.filter((role) => !roleIds.includes(role.id)),
  ]
  for (const role of changed) {
    assertCanManageRole(actor, role)
    // Removing a role must not be a way to revoke permissions outside the actor's authority.
    assertCanGrantPermissions(actor, role.permissions)
  }
  return roles
}

/** Call after every account/role mutation in the same locked transaction; throwing rolls it back. */
export async function assertAccessibleAdministrator(
  tx: Prisma.TransactionClient,
  emailConfig?: EmailConfig
) {
  const email = emailConfig ?? (await getEmailConfigForUpdate(tx))
  const oidcPrefix = oidcSubjectPrefix(
    (await readConfig(tx)).settings.general.oidc
  )
  const everyone = await tx.role.findUnique({
    where: { systemKey: EVERYONE_ROLE },
    select: { permissions: true },
  })
  // The role API never lets Everyone hold Administrator, but a direct database
  // edit can, and then every account is an administrator.
  const administrators = await tx.user.findMany({
    where: everyone?.permissions.includes('administrator')
      ? {}
      : { roles: { some: { permissions: { has: 'administrator' } } } },
  })
  if (
    !administrators.some(
      (user) =>
        Boolean(
          (user.email && user.password) ||
          (oidcPrefix && user.oidcSubject?.startsWith(oidcPrefix))
        ) && hasDurableEmailAccess(user, email)
    )
  )
    throw new PermissionError(
      'Keep at least one administrator who can sign in and meets the email access policy',
      409
    )
}
