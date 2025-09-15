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

    // Get file first to check visibility and ownership
    const file = await prisma.file.findUnique({
      where: { id },
      select: {
        mimeType: true,
        path: true,
        visibility: true,
        userId: true,
        password: true,
      },
    })

    if (!file) {
      return new NextResponse('File not found', { status: 404 })
    }

    if (!file.mimeType.startsWith('image/')) {
      return new NextResponse('Not an image', { status: 400 })
    }

    // Check access permissions (similar to main file endpoint)
    const isOwner = session?.user?.id === file.userId
    const isAdmin = session?.user?.role === 'ADMIN'
    const isPrivate = file.visibility === 'PRIVATE' && !isOwner && !isAdmin

    if (isPrivate) {
      return new NextResponse('File not found', { status: 404 })
    }

    // Skip password check for thumbnails (thumbnails should be accessible if file is accessible)
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
