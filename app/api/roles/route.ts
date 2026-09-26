import { NextResponse } from 'next/server'

import { getAccessSession } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { PERMISSION_GROUPS, hasPermission } from '@/lib/permissions/catalog'
import { readRoleJson, roleMutationGuard } from '@/lib/permissions/http'
import { roleCreateSchema } from '@/lib/permissions/schema'
import {
  PermissionError,
  assertCanGrantPermissions,
  assertCanManageRole,
  lockRoleChanges,
  requireActorPermission,
  requirePermission,
  roleSelect,
} from '@/lib/permissions/server'

export async function GET() {
  const session = await getAccessSession()
  if (!session?.user)
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    )
  if (
    !['roles.manage', 'users.roles', 'users.read'].some((permission) =>
      hasPermission(
        session.user,
        permission as 'roles.manage' | 'users.roles' | 'users.read'
      )
    )
  )
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
  const [roles, userCount] = await Promise.all([
    prisma.role.findMany({
      select: { ...roleSelect, _count: { select: { users: true } } },
      orderBy: [{ position: 'desc' }, { name: 'asc' }],
    }),
    prisma.user.count(),
  ])
  return NextResponse.json(
    {
      roles: roles.map(({ _count, ...role }) => ({
        ...role,
        memberCount: role.systemKey === 'everyone' ? userCount : _count.users,
      })),
      permissionGroups: PERMISSION_GROUPS,
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
}

export async function POST(request: Request) {
  const { user, response } = await requirePermission('roles.manage')
  if (response) return response
  const rejected = roleMutationGuard(request)
  if (rejected) return rejected
  const body = await readRoleJson(request)
  if (body.response) return body.response
  const parsed = roleCreateSchema.safeParse(body.data)
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Invalid role', details: parsed.error.flatten() },
      { status: 400 }
    )
  try {
    const role = await prisma.$transaction(async (tx) => {
      await lockRoleChanges(tx)
      const actor = await requireActorPermission(tx, user.id, 'roles.manage')
      assertCanManageRole(actor, parsed.data)
      assertCanGrantPermissions(actor, parsed.data.permissions)
      if ((await tx.role.count()) >= 100)
        throw new PermissionError(
          'This instance has reached the limit of 100 roles',
          400
        )
      return tx.role.create({ data: parsed.data, select: roleSelect })
    })
    return NextResponse.json(role, { status: 201 })
  } catch (error) {
    if (error instanceof PermissionError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      )
    console.error('Failed to create role:', error)
    return NextResponse.json(
      { error: 'Failed to create role' },
      { status: 500 }
    )
  }
}
