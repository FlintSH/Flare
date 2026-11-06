import { NextResponse } from 'next/server'

import { lockRoleChanges } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { assertJsonMutation, readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { PERMISSION_GROUPS } from '@/lib/permissions/catalog'
import { roleCreateSchema } from '@/lib/permissions/schema'
import {
  PermissionError,
  assertCanGrantPermissions,
  assertCanManageRole,
  requireActorPermission,
  roleSelect,
} from '@/lib/permissions/server'

const api = routes('/api/roles', {
  failure: { message: 'Internal server error' },
})

export const GET = api(async () => {
  await requireSession(['roles.manage', 'users.roles', 'users.read'])
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
})

export const POST = api(
  async (request) => {
    const { user } = await requireSession('roles.manage')
    assertJsonMutation(request)
    const parsed = roleCreateSchema.safeParse(
      await readJson(request, { limit: 32 * 1024 })
    )
    if (!parsed.success)
      throw new HttpError(400, 'Invalid role', {
        body: { details: parsed.error.flatten() },
      })
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
  },
  { failure: { message: 'Failed to create role' } }
)
