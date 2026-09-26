import { NextRequest, NextResponse } from 'next/server'

import { join } from 'path'

import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { sanitizeFilename } from '@/lib/security/paths'
import { getStorageProvider } from '@/lib/storage'
import {
  StorageTargetChangedError,
  getStorageProviderForTarget,
} from '@/lib/storage/target-provider'
import { parseStorageTarget } from '@/lib/storage/targets'

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

    const avatarPath = join('uploads', 'avatars', safeFilename)
    const owner = await prisma.user.findFirst({
      where: {
        OR: [
          { avatarStoragePath: avatarPath },
          { avatarStoragePath: null, image: `/api/avatars/${safeFilename}` },
        ],
      },
      select: { avatarStorageTarget: true, avatarStoragePath: true },
    })
    if (!owner) return new Response(null, { status: 404 })
    const target = parseStorageTarget(owner.avatarStorageTarget)
    // Historical avatars have no provenance; keep their existing read behavior.
    // New uploads always resolve their captured target, never another backend.
    if (owner.avatarStoragePath && !target)
      return new Response(null, { status: 503 })
    const storageProvider = target
      ? await getStorageProviderForTarget(target)
      : await getStorageProvider()

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
    if (error instanceof StorageTargetChangedError)
      return new Response(null, { status: 503 })
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT')
      return new Response(null, { status: 404 })
    logger.error('Avatar serve error', error as Error, {
      filename: (await params).filename,
    })
    return new Response(null, { status: 500 })
  }
}
