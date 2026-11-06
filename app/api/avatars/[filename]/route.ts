import { NextRequest, NextResponse } from 'next/server'

import { loggers } from '@/lib/logger'
import { sanitizeFilename } from '@/lib/security/paths'
import { getStorageProvider } from '@/lib/storage'
import { isMissingObject } from '@/lib/storage/missing'
import {
  StorageTargetChangedError,
  getStorageProviderForTarget,
} from '@/lib/storage/target-provider'
import { findAvatar } from '@/lib/users/avatar'

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

    const avatar = await findAvatar(safeFilename)
    if (!avatar) return new Response(null, { status: 404 })
    // Historical avatars have no provenance; keep their existing read behavior.
    // New uploads always resolve their captured target, never another backend.
    if (avatar.recorded && !avatar.target)
      return new Response(null, { status: 503 })
    const storageProvider = avatar.target
      ? await getStorageProviderForTarget(avatar.target)
      : await getStorageProvider()

    const publicUrl = await storageProvider.getPublicUrl(avatar.path)
    if (publicUrl) {
      return NextResponse.redirect(publicUrl)
    }

    const stream = await storageProvider.getFileStream(avatar.path)

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
    if (isMissingObject(error)) return new Response(null, { status: 404 })
    logger.error('Avatar serve error', error as Error, {
      filename: (await params).filename,
    })
    return new Response(null, { status: 500 })
  }
}
