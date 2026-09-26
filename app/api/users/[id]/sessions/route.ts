import { NextResponse } from 'next/server'

import { loggers } from '@/lib/logger'
import { mutateAccount } from '@/lib/permissions/account-mutations'
import { PermissionError } from '@/lib/permissions/server'
import { requirePermission } from '@/lib/permissions/server'
import { isSameOriginRequest } from '@/lib/security/request-origin'

const logger = loggers.users

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSameOriginRequest(request))
    return new NextResponse('Invalid request origin', { status: 403 })
  try {
    const { session, response: permissionDenied } =
      await requirePermission('users.sessions')
    if (permissionDenied) return permissionDenied

    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const { id } = await params

    await mutateAccount(session.user.id, id, 'users.sessions', (tx) =>
      tx.user.update({
        where: { id },
        data: {
          sessionVersion: {
            increment: 1,
          },
        },
      })
    )

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    if (error instanceof PermissionError)
      return Response.json({ error: error.message }, { status: error.status })
    logger.error('Error invalidating sessions:', error as Error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
