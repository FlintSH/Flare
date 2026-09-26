import { NextResponse } from 'next/server'

import { join } from 'path'

import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { mutateAccount } from '@/lib/permissions/account-mutations'
import { PermissionError } from '@/lib/permissions/server'
import { requirePermission } from '@/lib/permissions/server'
import { sanitizeFilename } from '@/lib/security/paths'
import { isSameOriginRequest } from '@/lib/security/request-origin'
import { getStorageProvider } from '@/lib/storage'

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

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        files: {
          select: {
            path: true,
          },
        },
      },
    })

    if (!user) {
      return new NextResponse('User not found', { status: 404 })
    }

    await mutateAccount(session.user.id, id, 'users.delete', (tx) =>
      tx.user.delete({ where: { id } })
    )

    const storageProvider = await getStorageProvider()

    for (const file of user.files) {
      try {
        await storageProvider.deleteFile(file.path)
      } catch (error) {
        logger.error(`Error deleting file ${file.path}:`, error as Error)
      }
    }

    if (user.image?.startsWith('/api/avatars/')) {
      try {
        const rawFilename = user.image.split('/').pop() || ''
        const safeFilename = sanitizeFilename(rawFilename)
        const avatarPath = join('uploads', 'avatars', safeFilename)
        await storageProvider.deleteFile(avatarPath)
      } catch (error) {
        logger.error('Error deleting avatar:', error as Error)
      }
    }

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    if (error instanceof PermissionError)
      return Response.json({ error: error.message }, { status: error.status })
    logger.error('Error deleting user:', error as Error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
