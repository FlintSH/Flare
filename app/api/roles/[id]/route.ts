import { lockRoleChanges } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { assertJsonMutation, readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { roleUpdateSchema } from '@/lib/permissions/schema'
import {
  PermissionError,
  assertAccessibleAdministrator,
  assertCanGrantPermissions,
  assertCanManageRole,
  requireActorPermission,
  roleSelect,
} from '@/lib/permissions/server'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/roles/[id]', {
  failure: { message: 'Failed to update role' },
})

export const PATCH = api(async (request, { params }: Context) => {
  const { user } = await requireSession('roles.manage')
  const { id } = await params
  assertJsonMutation(request)
  const parsed = roleUpdateSchema.safeParse(
    await readJson(request, { limit: 32 * 1024 })
  )
  if (!parsed.success)
    throw new HttpError(400, 'Invalid role', {
      body: { details: parsed.error.flatten() },
    })
  return prisma.$transaction(async (tx) => {
    await lockRoleChanges(tx)
    const actor = await requireActorPermission(tx, user.id, 'roles.manage')
    const current = await tx.role.findUnique({
      where: { id },
      select: roleSelect,
    })
    if (!current) throw new PermissionError('Role not found', 404)
    assertCanManageRole(actor, current)
    assertCanGrantPermissions(actor, current.permissions)
    const next = { ...current, ...parsed.data }
    if (current.systemKey === 'everyone') {
      if (
        next.name !== current.name ||
        next.position !== 0 ||
        next.permissions.includes('administrator')
      )
        throw new PermissionError(
          'Everyone must keep its name and position and cannot grant Administrator',
          400
        )
    } else if (next.position === 0)
      throw new PermissionError('Only Everyone may use position zero', 400)
    assertCanManageRole(actor, next)
    assertCanGrantPermissions(actor, next.permissions)
    const updated = await tx.role.update({
      where: { id },
      data: parsed.data,
      select: roleSelect,
    })
    await assertAccessibleAdministrator(tx)
    return updated
  })
})

export const DELETE = api(
  async (request, { params }: Context) => {
    const { user } = await requireSession('roles.manage')
    assertJsonMutation(request, { body: false })
    const { id } = await params
    await prisma.$transaction(async (tx) => {
      await lockRoleChanges(tx)
      const actor = await requireActorPermission(tx, user.id, 'roles.manage')
      const role = await tx.role.findUnique({
        where: { id },
        select: roleSelect,
      })
      if (!role) throw new PermissionError('Role not found', 404)
      if (role.systemKey === 'everyone')
        throw new PermissionError('Everyone cannot be deleted', 400)
      assertCanManageRole(actor, role)
      assertCanGrantPermissions(actor, role.permissions)
      await tx.role.delete({ where: { id } })
      await assertAccessibleAdministrator(tx)
    })
    return { success: true }
  },
  { failure: { message: 'Failed to delete role' } }
)
