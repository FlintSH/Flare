import { NextResponse } from 'next/server'

import { z } from 'zod'

import { withAuditRoute } from '@/lib/audit'
import { getAccessSession } from '@/lib/auth'
import { getConfig } from '@/lib/config'
import { everyoneCanInvite, setEveryoneCanInvite } from '@/lib/invites/service'
import { hasPermission } from '@/lib/permissions/catalog'
import { readRoleJson, roleMutationGuard } from '@/lib/permissions/http'
import { PermissionError } from '@/lib/permissions/server'

const headers = { 'Cache-Control': 'private, no-store' }
const policySchema = z.object({ everyoneCanInvite: z.boolean() }).strict()

async function handleGET() {
  const session = await getAccessSession()
  if (!session?.user)
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401, headers }
    )
  if (!hasPermission(session.user, 'settings.read'))
    return NextResponse.json(
      { error: 'Permission denied' },
      { status: 403, headers }
    )
  const config = await getConfig()
  return NextResponse.json(
    {
      everyoneCanInvite: await everyoneCanInvite(),
      limits: config.settings.general.registrations.inviteLimits,
    },
    { headers }
  )
}

async function handlePUT(request: Request) {
  const session = await getAccessSession()
  if (!session?.user)
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401, headers }
    )
  if (!hasPermission(session.user, 'settings.security'))
    return NextResponse.json(
      { error: 'Permission denied' },
      { status: 403, headers }
    )
  const rejected = roleMutationGuard(request)
  if (rejected) return rejected
  const body = await readRoleJson(request, 'Invite settings request')
  if (body.response) return body.response
  const parsed = policySchema.safeParse(body.data)
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Provide everyoneCanInvite as true or false' },
      { status: 400, headers }
    )
  try {
    return NextResponse.json(
      await setEveryoneCanInvite(
        session.user.id,
        parsed.data.everyoneCanInvite
      ),
      { headers }
    )
  } catch (error) {
    if (error instanceof PermissionError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers }
      )
    console.error('Could not update invite settings', error)
    return NextResponse.json(
      { error: 'Could not update invite settings' },
      { status: 500, headers }
    )
  }
}

export async function GET() {
  return withAuditRoute(async () => handleGET(), {
    route: '/api/settings/invites',
  })()
}

export async function PUT(request: Request) {
  return withAuditRoute(async () => handlePUT(request), {
    route: '/api/settings/invites',
  })(request)
}
