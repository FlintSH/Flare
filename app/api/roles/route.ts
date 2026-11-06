import { NextResponse } from 'next/server'

import { requireSession } from '@/lib/http/access'
import { assertJsonMutation, readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { PERMISSION_GROUPS } from '@/lib/permissions/catalog'
import { createRole, listRoles } from '@/lib/permissions/roles'

const api = routes('/api/roles', {
  failure: { message: 'Internal server error' },
})

export const GET = api(async () => {
  await requireSession(['roles.manage', 'users.roles', 'users.read'])
  return NextResponse.json(
    { roles: await listRoles(), permissionGroups: PERMISSION_GROUPS },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const POST = api(
  async (request) => {
    const { user } = await requireSession('roles.manage')
    assertJsonMutation(request)
    const role = await createRole(
      user.id,
      await readJson(request, { limit: 32 * 1024 })
    )
    return NextResponse.json(role, { status: 201 })
  },
  { failure: { message: 'Failed to create role' } }
)
