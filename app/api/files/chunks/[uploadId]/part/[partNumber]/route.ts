import { NextResponse } from 'next/server'

import { readFile } from 'fs/promises'
import { getServerSession } from 'next-auth'
import { join } from 'path'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { getStorageProvider } from '@/lib/storage'

interface RouteParams {
  uploadId: string
  partNumber: string
}

// Get user from either session or upload token
async function getAuthenticatedUser(req: Request) {
  const session = await getServerSession(authOptions)
  if (session?.user) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, storageUsed: true, urlId: true, role: true },
    })
    return user
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7)
    const user = await prisma.user.findUnique({
      where: { uploadToken: token },
      select: { id: true, storageUsed: true, urlId: true, role: true },
    })
    return user
  }

  return null
}

// Get upload metadata from temp file
async function getUploadMetadata(uploadId: string) {
  try {
    const TEMP_DIR = join(process.cwd(), 'tmp', 'uploads')
    const metadataPath = join(TEMP_DIR, uploadId)
    const data = await readFile(metadataPath, 'utf8')
    return JSON.parse(data)
  } catch (error) {
    if (error instanceof Error) {
      console.error(
        `[Server] Error reading metadata for upload ${uploadId}:`,
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

    const { uploadId, partNumber } = await context.params

    const metadata = await getUploadMetadata(uploadId)
    if (!metadata) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
    }

    if (metadata.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const storageProvider = await getStorageProvider()
    const url = await storageProvider.getPresignedPartUploadUrl(
      metadata.fileKey,
      uploadId,
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

    const { uploadId, partNumber } = await context.params

    const metadata = await getUploadMetadata(uploadId)
    if (!metadata) {
      console.log(`[Server] Upload ${uploadId} not found in metadata`)
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
    }

    if (metadata.userId !== user.id) {
      console.log(`[Server] Unauthorized access attempt for upload ${uploadId}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get the chunk data from the request
    const chunk = await req.arrayBuffer()

    // Upload the chunk to S3
    const storageProvider = await getStorageProvider()
    const response = await storageProvider.uploadPart(
      metadata.fileKey,
      uploadId,
      parseInt(partNumber),
      Buffer.from(chunk)
    )

    console.log(`[Server] Successfully uploaded part ${partNumber}`)

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
