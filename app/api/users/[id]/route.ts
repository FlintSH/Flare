import { NextResponse } from 'next/server'

import { loggers } from '@/lib/logger'
import { PermissionError } from '@/lib/permissions/server'
import { requirePermission } from '@/lib/permissions/server'
import { isSameOriginRequest } from '@/lib/security/request-origin'
import { deleteAccountWithStorageCleanup } from '@/lib/storage/deletion'

const logger = loggers.users

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSameOriginRequest(req))
    return new NextResponse('Invalid request origin', { status: 403 })
  try {
    const { session, response: permissionDenied } =
      await requirePermission('users.delete')
    if (permissionDenied) return permissionDenied
    const { id } = await params

    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    await deleteAccountWithStorageCleanup(session.user.id, id, 'users.delete')

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    if (error instanceof PermissionError)
      return Response.json({ error: error.message }, { status: error.status })
    logger.error('Error deleting user:', error as Error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
