import { NextResponse } from 'next/server'

import { withAuditRoute } from '@/lib/audit'
import { getAccessSession } from '@/lib/auth'
import { inviteCreateSchema } from '@/lib/invites/policy'
import {
  createInvite,
  inviteListQuerySchema,
  listInvites,
} from '@/lib/invites/service'
import { hasPermission } from '@/lib/permissions/catalog'
import { readRoleJson, roleMutationGuard } from '@/lib/permissions/http'
import { PermissionError, getUserAccess } from '@/lib/permissions/server'
import { generalLimiter, rateLimit } from '@/lib/security/rate-limit'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }

function failure(error: unknown, fallback: string) {
  if (error instanceof PermissionError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status, headers }
    )
  console.error(fallback, error)
  return NextResponse.json({ error: fallback }, { status: 500, headers })
}

async function handleGET(request: Request) {
  const session = await getAccessSession()
  if (!session?.user)
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401, headers }
    )
  if (
    !hasPermission(session.user, 'invites.create') &&
    !hasPermission(session.user, 'invites.manage')
  )
    return NextResponse.json(
      { error: 'Permission denied' },
      { status: 403, headers }
    )
  const parsed = inviteListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  )
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Choose a valid scope, status, page, and limit' },
      { status: 400, headers }
    )
  try {
    const access = await getUserAccess(session.user.id)
    return NextResponse.json(
      await listInvites(session.user.id, access, parsed.data),
      { headers }
    )
  } catch (error) {
    return failure(error, 'Could not load invites')
  }
}

async function handlePOST(request: Request) {
  const limited = await rateLimit(request, generalLimiter)
  if (limited) return limited
  const session = await getAccessSession()
  if (!session?.user)
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401, headers }
    )
  if (!hasPermission(session.user, 'invites.create'))
    return NextResponse.json(
      { error: 'Permission denied' },
      { status: 403, headers }
    )
  const rejected = roleMutationGuard(request)
  if (rejected) return rejected
  const body = await readRoleJson(request, 'Invite request')
  if (body.response) return body.response
  const parsed = inviteCreateSchema.safeParse(body.data)
  if (!parsed.success)
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message || 'Invalid invite',
        details: parsed.error.flatten(),
      },
      { status: 400, headers }
    )
  try {
    const invite = await createInvite(session.user.id, parsed.data)
    return NextResponse.json({ invite }, { status: 201, headers })
  } catch (error) {
    return failure(error, 'Could not create the invite')
  }
}

export async function GET(request: Request) {
  return withAuditRoute(async () => handleGET(request), {
    route: '/api/invites',
  })(request)
}

export async function POST(request: Request) {
  return withAuditRoute(async () => handlePOST(request), {
    route: '/api/invites',
  })(request)
}
