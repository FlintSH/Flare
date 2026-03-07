import { NextResponse } from 'next/server'

import { hash } from 'bcryptjs'
import { existsSync } from 'fs'
import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { join } from 'path'

import { requireAuth } from '@/lib/auth/api-auth'
import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { getUniqueFilename } from '@/lib/files/filename'
import { loggers } from '@/lib/logger'
import { processImageOCR } from '@/lib/ocr'
import { validateFileType } from '@/lib/security/file-validation'
import { validatePathSegment } from '@/lib/security/paths'
import { rateLimit, uploadLimiter } from '@/lib/security/rate-limit'
import { getStorageProvider } from '@/lib/storage'
import { bytesToMB } from '@/lib/utils'

const logger = loggers.files

const TEMP_DIR = join(process.cwd(), 'tmp', 'uploads')

if (!existsSync(TEMP_DIR)) {
  mkdir(TEMP_DIR, { recursive: true }).catch((error) => {
    logger.error('Failed to create temp directory', error as Error)
  })
}

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
          logger.error(`Error cleaning up file ${file}`, error as Error)
        }
      }
    } catch (error) {
      logger.error('Error during cleanup', error as Error)
    }
  },
  60 * 60 * 1000
)

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
  s3UploadId: string
}

function generateLocalId(): string {
  return Math.random().toString(36).substring(2, 15)
}

async function getUploadMetadata(
  localId: string
): Promise<UploadMetadata | null> {
  try {
    const safeId = validatePathSegment(localId)
    const metadataPath = join(TEMP_DIR, `meta-${safeId}`)
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

async function saveUploadMetadata(
  localId: string,
  metadata: UploadMetadata
): Promise<void> {
  const safeId = validatePathSegment(localId)
  const metadataPath = join(TEMP_DIR, `meta-${safeId}`)
  await writeFile(metadataPath, JSON.stringify(metadata))
}

async function deleteUploadMetadata(localId: string) {
  try {
    const safeId = validatePathSegment(localId)
    const metadataPath = join(TEMP_DIR, `meta-${safeId}`)
    await unlink(metadataPath)
  } catch (error) {
    logger.debug(`Error deleting metadata for upload ${localId}`, {
      error,
    })
  }
}

export async function POST(req: Request) {
  const limited = await rateLimit(req, uploadLimiter)
  if (limited) return limited

  try {
    const { user, response } = await requireAuth(req)
    if (response) return response

    const body = await req.json()
    const { filename, mimeType, size } = body

    if (!filename || !mimeType || !size) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    const config = await getConfig()
    const maxSize = config.settings.general.storage.maxUploadSize
    const maxBytes =
      maxSize.value * (maxSize.unit === 'GB' ? 1024 * 1024 * 1024 : 1024 * 1024)
    const quotasEnabled = config.settings.general.storage.quotas.enabled
    const defaultQuota = config.settings.general.storage.quotas.default

    if (size > maxBytes) {
      return NextResponse.json(
        {
          error: `Maximum file size is ${maxSize.value}${maxSize.unit}`,
        },
        { status: 413 }
      )
    }

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

    const { urlSafeName, displayName } = await getUniqueFilename(
      join('uploads', user.urlId),
      filename,
      user.randomizeFileUrls
    )

    let filePath: string
    let urlPath: string
    try {
      filePath = join('uploads', user.urlId, urlSafeName)
      if (!filePath.startsWith(join('uploads', user.urlId))) {
        throw new Error('Invalid file path: Path traversal detected')
      }
      urlPath = `/${user.urlId}/${urlSafeName}`
    } catch (error) {
      logger.error('Path validation error', error as Error, {
        userId: user.id,
        filename,
      })
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 })
    }

    const storageProvider = await getStorageProvider()
    const s3UploadId = await storageProvider.initializeMultipartUpload(
      filePath,
      mimeType
    )

    const localId = generateLocalId()

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
      s3UploadId,
    }

    await saveUploadMetadata(localId, metadata)

    return NextResponse.json({
      data: {
        uploadId: localId,
        fileKey: filePath,
      },
    })
  } catch (error) {
    logger.error('Error initializing upload', error as Error)
    return NextResponse.json(
      { error: 'Failed to initialize upload' },
      { status: 500 }
    )
  }
}

export async function GET(req: Request) {
  try {
    const { user, response } = await requireAuth(req)
    if (response) return response

    const url = new URL(req.url)
    const parts = url.pathname.split('/')
    const localId = parts[parts.length - 3]
    const partNumber = parseInt(parts[parts.length - 1])

    const metadata = await getUploadMetadata(localId)
    if (!metadata) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
    }

    if (metadata.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const storageProvider = await getStorageProvider()
    const presignedUrl = await storageProvider.getPresignedPartUploadUrl(
      metadata.fileKey,
      metadata.s3UploadId,
      partNumber
    )

    metadata.lastActivity = Date.now()
    await saveUploadMetadata(localId, metadata)

    return NextResponse.json({ data: { presignedUrl } })
  } catch (error) {
    logger.error('Error getting presigned URL', error as Error)
    return NextResponse.json(
      { error: 'Failed to get presigned URL' },
      { status: 500 }
    )
  }
}

export async function PUT(req: Request) {
  try {
    const { user, response } = await requireAuth(req)
    if (response) return response

    const url = new URL(req.url)
    const parts = url.pathname.split('/')
    const localId = parts[parts.length - 2]

    const metadata = await getUploadMetadata(localId)
    if (!metadata) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
    }

    if (metadata.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { parts: uploadedParts } = body

    const storageProvider = await getStorageProvider()
    await storageProvider.completeMultipartUpload(
      metadata.fileKey,
      metadata.s3UploadId,
      uploadedParts
    )

    const actualSize = await storageProvider.getFileSize(metadata.fileKey)
    const MAX_OVERSIZE_RATIO = 1.05
    if (actualSize > metadata.totalSize * MAX_OVERSIZE_RATIO) {
      try {
        await storageProvider.deleteFile(metadata.fileKey)
      } catch (cleanupErr) {
        logger.error('Failed to clean up oversized upload', cleanupErr as Error)
      }
      await deleteUploadMetadata(localId)
      return NextResponse.json(
        { error: 'Uploaded data exceeds declared file size' },
        { status: 413 }
      )
    }

    const MAGIC_BYTES_SIZE = 4100
    const headStream = await storageProvider.getFileStream(metadata.fileKey, {
      start: 0,
      end: Math.min(MAGIC_BYTES_SIZE - 1, actualSize - 1),
    })
    const headChunks: Buffer[] = []
    for await (const chunk of headStream) {
      headChunks.push(Buffer.from(chunk))
    }
    const headBuffer = Buffer.concat(headChunks)
    const typeCheck = await validateFileType(headBuffer, metadata.mimeType)
    if (!typeCheck.valid) {
      logger.warn('File type mismatch on chunked upload', {
        claimed: metadata.mimeType,
        detected: typeCheck.detectedType,
        userId: user.id,
      })
      try {
        await storageProvider.deleteFile(metadata.fileKey)
      } catch (cleanupErr) {
        logger.error(
          'Failed to clean up type-mismatch upload',
          cleanupErr as Error
        )
      }
      await deleteUploadMetadata(localId)
      return NextResponse.json(
        {
          error: `File type mismatch: detected ${typeCheck.detectedType}, claimed ${metadata.mimeType}`,
        },
        { status: 400 }
      )
    }

    const fileRecord = await prisma.$transaction(async (tx) => {
      const file = await tx.file.create({
        data: {
          name: metadata.filename,
          urlPath: metadata.urlPath,
          mimeType: metadata.mimeType,
          size: bytesToMB(actualSize),
          path: metadata.fileKey,
          visibility: metadata.visibility,
          password: metadata.password
            ? await hash(metadata.password, 10)
            : null,
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
            increment: bytesToMB(actualSize),
          },
        },
      })

      return file
    })

    await deleteUploadMetadata(localId)

    if (metadata.mimeType.startsWith('image/')) {
      processImageOCR(metadata.fileKey, fileRecord.id).catch((error: Error) => {
        logger.error('Background OCR processing failed', error, {
          fileId: fileRecord.id,
          fileKey: metadata.fileKey,
        })
      })
    }

    return NextResponse.json({
      data: { success: true },
    })
  } catch (error) {
    logger.error('Error completing upload', error as Error)
    return NextResponse.json(
      { error: 'Failed to complete upload' },
      { status: 500 }
    )
  }
}
