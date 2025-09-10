import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { getStorageProvider } from '@/lib/storage'

const logger = loggers.files

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const [session, { id }] = await Promise.all([
      getServerSession(authOptions),
      params,
    ])

    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const file = await prisma.file.findUnique({
      where: {
        id,
        ...(session.user.role !== 'ADMIN' && { userId: session.user.id }),
      },
      select: {
        mimeType: true,
        path: true,
      },
    })

    if (!file) {
      return new NextResponse('File not found', { status: 404 })
    }

    if (!file.mimeType.startsWith('image/')) {
      return new NextResponse('Not an image', { status: 400 })
    }

    const storageProvider = await getStorageProvider()
    const fileStream = await storageProvider.getFileStream(file.path)

    // Just serve the original image - let the browser/CSS handle sizing
    return new NextResponse(fileStream as unknown as BodyInit, {
      headers: {
        'Content-Type': file.mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (error) {
    logger.error('Error serving thumbnail:', error as Error)
    return new NextResponse('Error serving thumbnail', { status: 500 })
  }
}
