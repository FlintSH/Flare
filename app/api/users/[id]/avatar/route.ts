import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'
import { join } from 'path'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { getStorageProvider } from '@/lib/storage'

const logger = loggers.users

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    const { id } = await params

    if (!session?.user || session.user.role !== 'ADMIN') {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: { image: true },
    })

    if (!user) {
      return new NextResponse('User not found', { status: 404 })
    }

    if (user.image?.startsWith('/api/avatars/')) {
      try {
        const storageProvider = await getStorageProvider()
        const filename = user.image.split('/').pop()
        if (filename) {
          const avatarPath = join('uploads', 'avatars', filename)
          await storageProvider.deleteFile(avatarPath)
        }
      } catch (error) {
        logger.error('Error deleting avatar file', error as Error, {
          userId: id,
          avatarPath: user.image,
        })
      }
    }

    await prisma.user.update({
      where: { id },
      data: { image: null },
    })

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    logger.error('Error removing avatar', error as Error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
