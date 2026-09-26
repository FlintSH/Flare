import { NextResponse } from 'next/server'

import { prisma } from '@/lib/database/prisma'
import { readRoleJson, roleMutationGuard } from '@/lib/permissions/http'
import { roleUpdateSchema } from '@/lib/permissions/schema'
import {
  PermissionError,
  assertAccessibleAdministrator,
  assertCanGrantPermissions,
  assertCanManageRole,
  lockRoleChanges,
  requireActorPermission,
  requirePermission,
  roleSelect,
} from '@/lib/permissions/server'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, context: Context) {
  const { user, response } = await requirePermission('roles.manage')
  if (response) return response
  const { id } = await context.params
  const rejected = roleMutationGuard(request)
  if (rejected) return rejected
  const body = await readRoleJson(request)
  if (body.response) return body.response
  const parsed = roleUpdateSchema.safeParse(body.data)
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Invalid role', details: parsed.error.flatten() },
      { status: 400 }
    )
  try {
    const role = await prisma.$transaction(async (tx) => {
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
    return NextResponse.json(role)
  } catch (error) {
    if (error instanceof PermissionError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      )
    console.error('Failed to update role:', error)
    return NextResponse.json(
      { error: 'Failed to update role' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request, context: Context) {
  const { user, response } = await requirePermission('roles.manage')
  if (response) return response
  const rejected = roleMutationGuard(request)
  if (rejected) return rejected
  const { id } = await context.params
  try {
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
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof PermissionError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      )
    console.error('Failed to delete role:', error)
    return NextResponse.json(
      { error: 'Failed to delete role' },
      { status: 500 }
    )
  }
}
