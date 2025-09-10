import { NextResponse } from 'next/server'

import { readFile } from 'fs/promises'
import { join } from 'path'

import { getAuthenticatedUser } from '@/lib/auth/api-auth'
import { loggers } from '@/lib/logger'
import { getStorageProvider } from '@/lib/storage'

const logger = loggers.files

interface RouteParams {
  uploadId: string
  partNumber: string
}

async function getUploadMetadata(localId: string) {
  try {
    const TEMP_DIR = join(process.cwd(), 'tmp', 'uploads')
    const metadataPath = join(TEMP_DIR, `meta-${localId}`)
    const data = await readFile(metadataPath, 'utf8')
    return JSON.parse(data)
  } catch (error) {
    if (error instanceof Error) {
      logger.debug(`Error reading metadata for upload ${localId}`, {
        error: error.message,
      })
    }
    return null
  }
}

export async function GET(
  req: Request,
  context: { params: Promise<RouteParams> }
) {
  try {
    const user = await getAuthenticatedUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { uploadId: localId, partNumber } = await context.params

    const metadata = await getUploadMetadata(localId)
    if (!metadata) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
    }

    if (metadata.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const storageProvider = await getStorageProvider()
    const url = await storageProvider.getPresignedPartUploadUrl(
      metadata.fileKey,
      metadata.s3UploadId,
      parseInt(partNumber)
    )

    return NextResponse.json({
      data: { url },
    })
  } catch (error) {
    logger.error('Error getting presigned URL:', error as Error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to get presigned URL',
      },
      { status: 500 }
    )
  }
}

export async function PUT(
  req: Request,
  context: { params: Promise<RouteParams> }
) {
  try {
    const user = await getAuthenticatedUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { uploadId: localId, partNumber } = await context.params

    const metadata = await getUploadMetadata(localId)
    if (!metadata) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
    }

    if (metadata.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const chunk = await req.arrayBuffer()

    const storageProvider = await getStorageProvider()
    const response = await storageProvider.uploadPart(
      metadata.fileKey,
      metadata.s3UploadId,
      parseInt(partNumber),
      Buffer.from(chunk)
    )

    return NextResponse.json({
      data: { etag: response.ETag },
    })
  } catch (error) {
    logger.error('Error uploading part:', error as Error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to upload part',
      },
      { status: 500 }
    )
  }
}
