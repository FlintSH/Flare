import { NextResponse } from 'next/server'

import { Prisma } from '@prisma/client'

import { getAccessSession } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { getEmailConfigForUpdate } from '@/lib/email/config'
import {
  hasDurableEmailAccess,
  requiresEmailVerification,
} from '@/lib/email/policy'
import type { EmailConfig } from '@/lib/email/schema'

import {
  DEFAULT_PERMISSIONS,
  Permission,
  RoleSummary,
  hasPermission,
  highestRolePosition,
  resolvePermissions,
} from './catalog'

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

export class PermissionError extends Error {
  constructor(
    message: string,
    public readonly status = 403
  ) {
    super(message)
    this.name = 'PermissionError'
  }
}

/** Settings must always be locked before access, matching email-policy writers. */
export async function lockRoleChanges(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(721150092)`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(712347202)`
}

/** Safe for migrated instances and freshly initialized databases. Never overwrite customizations. */
export async function ensureBuiltInRoles(tx: Prisma.TransactionClient) {
  const everyone = await tx.role.upsert({
    where: { systemKey: 'everyone' },
    update: {},
    create: {
      name: 'Everyone',
      description: 'Base permissions for every account.',
      color: '#64748b',
      position: 0,
      permissions: [...DEFAULT_PERMISSIONS],
      systemKey: 'everyone',
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
      where: { systemKey: 'everyone' },
      select: roleSelect,
    }),
  ])
  if (!user) return { roles: [], permissions: [] }
  const roles = [
    ...user.roles.filter((role) => role.systemKey !== 'everyone'),
    ...(everyone ? [everyone] : []),
  ].sort((a, b) => b.position - a.position || a.name.localeCompare(b.name))
  return { roles, permissions: resolvePermissions(roles) }
}

/** Session-only guard. A named or legacy API token can never authorize role management. */
export async function requirePermission(permission: Permission) {
  const session = await getAccessSession()
  if (!session?.user)
    return {
      user: null,
      session: null,
      response: NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      ),
    } as const
  if (!hasPermission(session.user, permission))
    return {
      user: null,
      session: null,
      response: NextResponse.json(
        { error: 'Permission denied' },
        { status: 403 }
      ),
    } as const
  return { user: session.user, session, response: null } as const
}

/** Recheck authority after acquiring the mutation lock, never trust a pre-lock session snapshot. */
export async function requireActorPermission(
  tx: Prisma.TransactionClient,
  userId: string,
  permission: Permission
): Promise<UserAccess> {
  const user = await tx.user.findUnique({ where: { id: userId } })
  const email = await getEmailConfigForUpdate(tx)
  if (!user || requiresEmailVerification(user, email))
    throw new PermissionError('Your account no longer has access')
  const access = await getUserAccess(userId, tx)
  if (!hasPermission(access, permission))
    throw new PermissionError('You no longer have permission for this action')
  return access
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
  if (hasPermission(actor, 'administrator')) return
  if (
    actorId === targetId ||
    hasPermission(target, 'administrator') ||
    highestRolePosition(actor) <= highestRolePosition(target)
  )
    throw new PermissionError(
      'You can only manage accounts below your highest role'
    )
  // Resetting a lower account’s credentials must not transfer authority the
  // actor could not grant directly. Hierarchy alone does not imply a subset.
  if (
    target.permissions.some((permission) => !hasPermission(actor, permission))
  ) {
    throw new PermissionError(
      'You can only manage accounts whose permissions you already have'
    )
  }
}

export function assertCanManageRole(
  actor: UserAccess,
  role: Pick<RoleSummary, 'position' | 'permissions'>
) {
  if (hasPermission(actor, 'administrator')) return
  if (
    role.position >= highestRolePosition(actor) ||
    role.permissions.includes('administrator')
  )
    throw new PermissionError(
      'You can only manage roles below your highest role'
    )
}

export function assertCanGrantPermissions(
  actor: UserAccess,
  permissions: readonly string[]
) {
  if (hasPermission(actor, 'administrator')) return
  if (
    permissions.some(
      (permission) =>
        permission === 'administrator' ||
        !actor.permissions.includes(permission as Permission)
    )
  )
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
  if (
    roles.length !== roleIds.length ||
    roles.some((role) => role.systemKey === 'everyone')
  )
    throw new PermissionError(
      'Choose existing roles; Everyone applies automatically',
      400
    )
  const current = targetId
    ? (await getUserAccess(targetId, tx)).roles.filter(
        (role) => role.systemKey !== 'everyone'
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
  const row = await tx.config.findUnique({ where: { key: 'flare_config' } })
  const oidc = (
    row?.value as {
      settings?: {
        general?: {
          oidc?: {
            enabled?: boolean
            issuer?: string
            clientId?: string
            clientSecret?: string
          }
        }
      }
    } | null
  )?.settings?.general?.oidc
  const oidcPrefix =
    oidc?.enabled && oidc.issuer && oidc.clientId && oidc.clientSecret
      ? `${oidc.issuer.replace(/\/+$/, '')}|`
      : null
  const everyone = await tx.role.findUnique({
    where: { systemKey: 'everyone' },
    select: { permissions: true },
  })
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
