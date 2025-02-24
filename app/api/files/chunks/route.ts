import { NextResponse } from 'next/server'

import { existsSync } from 'fs'
import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { getServerSession } from 'next-auth'
import { join } from 'path'

import { authOptions } from '@/lib/auth'
import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { getUniqueFilename } from '@/lib/files/filename'
import { processImageOCR } from '@/lib/ocr'
import { getStorageProvider } from '@/lib/storage'
import { bytesToMB } from '@/lib/utils'

// Store upload metadata in a temp file
const TEMP_DIR = join(process.cwd(), 'tmp', 'uploads')

// Create temp directory if it doesn't exist
if (!existsSync(TEMP_DIR)) {
  mkdir(TEMP_DIR, { recursive: true }).catch(console.error)
}

// Clean up stale uploads every hour (honestly could be done better, PRs welcome)
setInterval(
  async () => {
    try {
      const { readdir } = await import('fs/promises')
      const files = await readdir(TEMP_DIR)
      const now = Date.now()

      for (const file of files) {
        try {
          const metadataPath = join(TEMP_DIR, file)
          const metadata = JSON.parse(await readFile(metadataPath, 'utf8'))

          if (now - metadata.lastActivity > 60 * 60 * 1000) {
            await unlink(metadataPath)
          }
        } catch (error) {
          console.error(`Error cleaning up file ${file}:`, error)
        }
      }
    } catch (error) {
      console.error('Error during cleanup:', error)
    }
  },
  60 * 60 * 1000
)

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

interface UploadMetadata {
  fileKey: string
  filename: string
  mimeType: string
  totalSize: number
  userId: string
  visibility: 'PUBLIC' | 'PRIVATE'
  password: string | null
  lastActivity: number
  urlPath: string
}

async function getUploadMetadata(
  uploadId: string
): Promise<UploadMetadata | null> {
  try {
    const metadataPath = join(TEMP_DIR, uploadId)
    const data = await readFile(metadataPath, 'utf8')
    return JSON.parse(data)
  } catch (error) {
    if (error instanceof Error) {
      console.error(
        `Error reading metadata for upload ${uploadId}:`,
        error.message
      )
    }
    return null
  }
}

async function saveUploadMetadata(
  uploadId: string,
  metadata: UploadMetadata
): Promise<void> {
  const metadataPath = join(TEMP_DIR, uploadId)
  await writeFile(metadataPath, JSON.stringify(metadata))
}

async function deleteUploadMetadata(uploadId: string) {
  try {
    const metadataPath = join(TEMP_DIR, uploadId)
    await unlink(metadataPath)
  } catch (error) {
    console.error(`Error deleting metadata for upload ${uploadId}:`, error)
  }
}

// Initialize multipart upload
export async function POST(req: Request) {
  try {
    const user = await getAuthenticatedUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { filename, mimeType, size } = body

    // Validate required fields
    if (!filename || !mimeType || !size) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Get config to check max upload size and quotas
    const config = await getConfig()
    const maxSize = config.settings.general.storage.maxUploadSize
    const maxBytes =
      maxSize.value * (maxSize.unit === 'GB' ? 1024 * 1024 * 1024 : 1024 * 1024)
    const quotasEnabled = config.settings.general.storage.quotas.enabled
    const defaultQuota = config.settings.general.storage.quotas.default

    // Validate total size
    if (size > maxBytes) {
      return NextResponse.json(
        {
          error: `Maximum file size is ${maxSize.value}${maxSize.unit}`,
        },
        { status: 413 }
      )
    }

    // Check quota if enabled (skip for admins)
    if (quotasEnabled && user.role !== 'ADMIN') {
      const quotaMB =
        defaultQuota.value * (defaultQuota.unit === 'GB' ? 1024 : 1)
      const fileSizeMB = bytesToMB(size)

      if (user.storageUsed + fileSizeMB > quotaMB) {
        return NextResponse.json(
          {
            error: `You have reached your storage quota of ${defaultQuota.value}${defaultQuota.unit}`,
          },
          { status: 413 }
        )
      }
    }

    // Get unique filename and paths
    const { urlSafeName, displayName } = await getUniqueFilename(
      join('uploads', user.urlId),
      filename
    )

    // Construct paths with validation
    let filePath: string
    let urlPath: string
    try {
      filePath = join('uploads', user.urlId, urlSafeName)
      if (!filePath.startsWith(join('uploads', user.urlId))) {
        throw new Error('Invalid file path: Path traversal detected')
      }
      urlPath = `/${user.urlId}/${urlSafeName}`
    } catch (error) {
      console.error('Path validation error:', error)
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 })
    }

    // Initialize multipart upload
    const storageProvider = await getStorageProvider()
    const uploadId = await storageProvider.initializeMultipartUpload(
      filePath,
      mimeType
    )

    // Store metadata in temp file
    const metadata: UploadMetadata = {
      fileKey: filePath,
      filename: displayName,
      mimeType,
      totalSize: size,
      userId: user.id,
      visibility: 'PUBLIC' as const,
      password: null,
      lastActivity: Date.now(),
      urlPath,
    }

    await saveUploadMetadata(uploadId, metadata)

    return NextResponse.json({
      data: {
        uploadId,
        fileKey: filePath,
      },
    })
  } catch (error) {
    console.error('Error initializing upload:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to initialize upload',
      },
      { status: 500 }
    )
  }
}

// Get presigned URL for part upload
export async function GET(req: Request) {
  try {
    const user = await getAuthenticatedUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(req.url)
    const parts = url.pathname.split('/')
    const uploadId = parts[parts.length - 3]
    const partNumber = parseInt(parts[parts.length - 1])

    const metadata = await getUploadMetadata(uploadId)
    if (!metadata) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
    }

    if (metadata.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const storageProvider = await getStorageProvider()
    const presignedUrl = await storageProvider.getPresignedPartUploadUrl(
      metadata.fileKey,
      uploadId,
      partNumber
    )

    metadata.lastActivity = Date.now()
    await saveUploadMetadata(uploadId, metadata)

    return NextResponse.json({
      data: { url: presignedUrl },
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

// Complete multipart upload
export async function PUT(req: Request) {
  try {
    const user = await getAuthenticatedUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(req.url)
    const parts = url.pathname.split('/')
    const uploadId = parts[parts.length - 1]

    const metadata = await getUploadMetadata(uploadId)
    if (!metadata) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
    }

    if (metadata.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { parts: uploadParts } = body

    if (!Array.isArray(uploadParts)) {
      return NextResponse.json({ error: 'Invalid parts data' }, { status: 400 })
    }

    const storageProvider = await getStorageProvider()
    await storageProvider.completeMultipartUpload(
      metadata.fileKey,
      uploadId,
      uploadParts
    )

    // Create database record
    const fileRecord = await prisma.$transaction(async (tx) => {
      const file = await tx.file.create({
        data: {
          name: metadata.filename,
          urlPath: metadata.urlPath,
          mimeType: metadata.mimeType,
          size: bytesToMB(metadata.totalSize),
          path: metadata.fileKey,
          visibility: metadata.visibility,
          password: metadata.password,
          user: {
            connect: {
              id: metadata.userId,
            },
          },
        },
      })

      await tx.user.update({
        where: { id: metadata.userId },
        data: {
          storageUsed: {
            increment: bytesToMB(metadata.totalSize),
          },
        },
      })

      return file
    })

    // Clean up metadata
    await deleteUploadMetadata(uploadId)

    // Process OCR if it's an image
    if (metadata.mimeType.startsWith('image/')) {
      processImageOCR(metadata.fileKey, fileRecord.id).catch((error: Error) => {
        console.error('Background OCR processing failed:', error)
      })
    }

    return NextResponse.json({
      data: { success: true },
    })
  } catch (error) {
    console.error('Error completing upload:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to complete upload',
      },
      { status: 500 }
    )
  }
}
