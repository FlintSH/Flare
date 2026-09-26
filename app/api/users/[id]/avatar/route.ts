import { NextResponse } from 'next/server'

import { Prisma } from '@prisma/client'

import { loggers } from '@/lib/logger'
import { mutateAccount } from '@/lib/permissions/account-mutations'
import { PermissionError } from '@/lib/permissions/server'
import { requirePermission } from '@/lib/permissions/server'
import { isSameOriginRequest } from '@/lib/security/request-origin'
import { queueAvatarStorageDeletion } from '@/lib/storage/deletion'

const logger = loggers.users

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSameOriginRequest(req))
    return new NextResponse('Invalid request origin', { status: 403 })
  try {
    const { session, response: permissionDenied } =
      await requirePermission('users.update')
    if (permissionDenied) return permissionDenied
    const { id } = await params

    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    await mutateAccount(session.user.id, id, 'users.update', async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`
      const user = await tx.user.findUnique({ where: { id } })
      if (!user) throw new PermissionError('User not found', 404)
      await queueAvatarStorageDeletion(tx, user)
      await tx.user.update({
        where: { id },
        data: {
          image: null,
          avatarStoragePath: null,
          avatarStorageTarget: Prisma.DbNull,
        },
      })
    })

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    if (error instanceof PermissionError)
      return Response.json({ error: error.message }, { status: error.status })
    logger.error('Error removing avatar', error as Error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
