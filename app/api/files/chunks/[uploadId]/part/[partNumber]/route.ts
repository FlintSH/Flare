import { NextResponse } from 'next/server'

import { readFile } from 'fs/promises'
import { join } from 'path'

import { getAuthenticatedUser } from '@/lib/auth/api-auth'
import { getStorageProvider } from '@/lib/storage'

interface RouteParams {
  uploadId: string
  partNumber: string
}

// Get upload metadata from temp file
async function getUploadMetadata(localId: string) {
  try {
    const TEMP_DIR = join(process.cwd(), 'tmp', 'uploads')
    const metadataPath = join(TEMP_DIR, `meta-${localId}`)
    const data = await readFile(metadataPath, 'utf8')
    return JSON.parse(data)
  } catch (error) {
    if (error instanceof Error) {
      console.error(
        `Error reading metadata for upload ${localId}:`,
        error.message
      )
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
    console.error('Error getting presigned URL:', error)
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

    // Get the chunk data from the request
    const chunk = await req.arrayBuffer()

    // Upload the chunk to S3
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
    console.error('Error uploading part:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to upload part',
      },
      { status: 500 }
    )
  }
}
