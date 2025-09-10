import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { getStorageProvider } from '@/lib/storage'

const logger = loggers.files

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions)
    const { id: userId, fileId } = await params

    if (!session?.user || session.user.role !== 'ADMIN') {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const file = await prisma.file.findUnique({
      where: {
        id: fileId,
        userId,
      },
    })

    if (!file) {
      return new NextResponse('File not found', { status: 404 })
    }

    try {
      const storageProvider = await getStorageProvider()
      await storageProvider.deleteFile(file.path)
    } catch (error) {
      logger.error('Error deleting file from storage:', error as Error)
    }

    await prisma.$transaction(async (tx) => {
      await tx.file.delete({
        where: {
          id: fileId,
          userId,
        },
      })

      await tx.user.update({
        where: { id: userId },
        data: {
          storageUsed: {
            decrement: file.size,
          },
        },
      })
    })

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    logger.error('Error deleting file:', error as Error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions)
    const { id: userId, fileId } = await params

    if (!session?.user || session.user.role !== 'ADMIN') {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const body = await request.json()
    const { visibility, password } = body

    const file = await prisma.file.update({
      where: {
        id: fileId,
        userId,
      },
      data: {
        visibility,
        ...(password && { password }),
      },
    })

    return NextResponse.json(file)
  } catch (error) {
    logger.error('Error updating file:', error as Error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
