import type { Prisma } from '@prisma/client'
import type { z } from 'zod'

import { lockRoleChanges } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { HttpError } from '@/lib/http/errors'

import type { Permission, RoleSummary } from './catalog'
import { EVERYONE_POSITION, isEveryoneRole, roleCanHold } from './policy'
import { roleCreateSchema, roleUpdateSchema } from './schema'
import {
  PermissionError,
  type UserAccess,
  assertAccessibleAdministrator,
  assertCanGrantPermissions,
  assertCanManageRole,
  ensureBuiltInRoles,
  requireActorPermission,
  roleSelect,
} from './server'

/** Built-in roles count toward it. */
const MAX_ROLES = 100

function parseRole<Fields>(schema: z.ZodType<Fields>, body: unknown): Fields {
  const parsed = schema.safeParse(body)
  if (!parsed.success)
    throw new HttpError(400, 'Invalid role', {
      body: { details: parsed.error.flatten() },
    })
  return parsed.data
}

/** Only someone who outranks a role and holds everything it grants may change it. */
function assertMayChange(
  actor: UserAccess,
  role: Pick<RoleSummary, 'position' | 'permissions'>
) {
  assertCanManageRole(actor, role)
  assertCanGrantPermissions(actor, role.permissions)
}

async function findRole(tx: Prisma.TransactionClient, id: string) {
  const role = await tx.role.findUnique({ where: { id }, select: roleSelect })
  if (!role) throw new PermissionError('Role not found', 404)
  return role
}

/** Every role, highest first, with its member count. Everyone's members are every account. */
export async function listRoles() {
  const [roles, accounts] = await Promise.all([
    prisma.role.findMany({
      select: { ...roleSelect, _count: { select: { users: true } } },
      orderBy: [{ position: 'desc' }, { name: 'asc' }],
    }),
    prisma.user.count(),
  ])
  return roles.map(({ _count, ...role }) => ({
    ...role,
    memberCount: isEveryoneRole(role) ? accounts : _count.users,
  }))
}

export async function createRole(actorId: string, body: unknown) {
  const role = parseRole(roleCreateSchema, body)
  return prisma.$transaction(async (tx) => {
    await lockRoleChanges(tx)
    const actor = await requireActorPermission(tx, actorId, 'roles.manage')
    assertMayChange(actor, role)
    if ((await tx.role.count()) >= MAX_ROLES)
      throw new PermissionError(
        `This instance has reached the limit of ${MAX_ROLES} roles`,
        400
      )
    return tx.role.create({ data: role, select: roleSelect })
  })
}

export async function updateRole(actorId: string, id: string, body: unknown) {
  const changes = parseRole(roleUpdateSchema, body)
  return prisma.$transaction(async (tx) => {
    await lockRoleChanges(tx)
    const actor = await requireActorPermission(tx, actorId, 'roles.manage')
    const current = await findRole(tx, id)
    assertMayChange(actor, current)
    const next = { ...current, ...changes }
    if (isEveryoneRole(current)) {
      if (
        next.name !== current.name ||
        next.position !== EVERYONE_POSITION ||
        !next.permissions.every((permission) =>
          roleCanHold(current, permission)
        )
      )
        throw new PermissionError(
          'Everyone must keep its name and position and cannot grant Administrator',
          400
        )
    } else if (next.position === EVERYONE_POSITION)
      throw new PermissionError('Only Everyone may use position zero', 400)
    assertMayChange(actor, next)
    const updated = await tx.role.update({
      where: { id },
      data: changes,
      select: roleSelect,
    })
    await assertAccessibleAdministrator(tx)
    return updated
  })
}

export async function deleteRole(actorId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    await lockRoleChanges(tx)
    const actor = await requireActorPermission(tx, actorId, 'roles.manage')
    const role = await findRole(tx, id)
    if (isEveryoneRole(role))
      throw new PermissionError('Everyone cannot be deleted', 400)
    assertMayChange(actor, role)
    await tx.role.delete({ where: { id } })
    await assertAccessibleAdministrator(tx)
  })
}

/**
 * Turn one of Everyone's permissions on or off, creating the built-in roles
 * if they are missing. `authorize` is the caller's own authority rule; it runs
 * under the role lock before anything changes. Everyone never holds
 * Administrator, so this can't change who administers the instance.
 */
export async function setEveryonePermission(
  permission: Exclude<Permission, 'administrator'>,
  enabled: boolean,
  authorize: (tx: Prisma.TransactionClient) => Promise<void>
) {
  await prisma.$transaction(async (tx) => {
    await lockRoleChanges(tx)
    await authorize(tx)
    const { everyone } = await ensureBuiltInRoles(tx)
    if (everyone.permissions.includes(permission) === enabled) return
    await tx.role.update({
      where: { id: everyone.id },
      data: {
        permissions: enabled
          ? [...everyone.permissions, permission]
          : everyone.permissions.filter((key) => key !== permission),
      },
    })
  })
}
