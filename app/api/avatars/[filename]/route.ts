import { NextRequest, NextResponse } from 'next/server'

import { join } from 'path'

import { loggers } from '@/lib/logger'
import { sanitizeFilename } from '@/lib/security/paths'
import { getStorageProvider } from '@/lib/storage'

const logger = loggers.files

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params

    let safeFilename: string
    try {
      safeFilename = sanitizeFilename(filename)
    } catch {
      return new Response(null, { status: 400 })
    }

    const storageProvider = await getStorageProvider()
    const avatarPath = join('uploads', 'avatars', safeFilename)

    const publicUrl = await storageProvider.getPublicUrl(avatarPath)
    if (publicUrl) {
      return NextResponse.redirect(publicUrl)
    }

    const stream = await storageProvider.getFileStream(avatarPath)

    return new NextResponse(stream as unknown as ReadableStream, {
      headers: {
        'Content-Type': 'image/jpeg',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (error) {
    logger.error('Avatar serve error', error as Error, {
      filename: (await params).filename,
    })
    return new Response(null, { status: 500 })
  }
}
