import { NextResponse } from 'next/server'

import { withAuditRoute } from '@/lib/audit'
import { getAccessSession } from '@/lib/auth'
import { revokeInvite } from '@/lib/invites/service'
import { hasPermission } from '@/lib/permissions/catalog'
import { roleMutationGuard } from '@/lib/permissions/http'
import { PermissionError } from '@/lib/permissions/server'
import { generalLimiter, rateLimit } from '@/lib/security/rate-limit'

type Context = { params: Promise<{ id: string }> }
const headers = { 'Cache-Control': 'private, no-store' }

async function handleDELETE(request: Request, context: Context) {
  const limited = await rateLimit(request, generalLimiter)
  if (limited) return limited
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
  const rejected = roleMutationGuard(request)
  if (rejected) return rejected
  const { id } = await context.params
  if (!id || id.length > 128)
    return NextResponse.json(
      { error: 'Invite not found' },
      { status: 404, headers }
    )
  try {
    const invite = await revokeInvite(session.user.id, id)
    return NextResponse.json({ invite }, { headers })
  } catch (error) {
    if (error instanceof PermissionError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers }
      )
    console.error('Could not revoke the invite', error)
    return NextResponse.json(
      { error: 'Could not revoke the invite' },
      { status: 500, headers }
    )
  }
}

export async function DELETE(request: Request, context: Context) {
  return withAuditRoute(async () => handleDELETE(request, context), {
    route: '/api/invites/[id]',
  })(request)
}
