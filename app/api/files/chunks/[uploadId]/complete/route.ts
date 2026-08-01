import { NextResponse } from 'next/server'

import { FileUploadResponse } from '@/types/dto/file'
import { hash } from 'bcryptjs'
import { getServerSession } from 'next-auth'
import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { scheduleFileExpiration } from '@/lib/events/handlers/file-expiry'
import { loggers } from '@/lib/logger'
import { processImageOCR } from '@/lib/ocr'
import { validateFileType } from '@/lib/security/file-validation'
import { validatePathSegment } from '@/lib/security/paths'
import { getStorageProvider } from '@/lib/storage'
import { bytesToMB } from '@/lib/utils'

const logger = loggers.files

interface RouteParams {
  uploadId: string
}

async function getAuthenticatedUser(req: Request) {
  const session = await getServerSession(authOptions)
  if (session?.user) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        storageUsed: true,
        urlId: true,
        vanityId: true,
        role: true,
      },
    })
    return user
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7)
    const user = await prisma.user.findUnique({
      where: { uploadToken: token },
      select: {
        id: true,
        storageUsed: true,
        urlId: true,
        vanityId: true,
        role: true,
      },
    })
    return user
  }

  return null
}

async function getUploadMetadata(localId: string) {
  try {
    const safeId = validatePathSegment(localId)
    const TEMP_DIR = join(process.cwd(), 'tmp', 'uploads')
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

async function deleteUploadMetadata(localId: string) {
  try {
    const safeId = validatePathSegment(localId)
    const TEMP_DIR = join(process.cwd(), 'tmp', 'uploads')
    const metadataPath = join(TEMP_DIR, `meta-${safeId}`)
    await unlink(metadataPath)
  } catch (err) {
    logger.debug(`Error deleting metadata for upload ${localId}`, {
      error: err,
    })
  }
}

export async function POST(
  req: Request,
  context: { params: Promise<RouteParams> }
) {
  try {
    const user = await getAuthenticatedUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { uploadId: localId } = await context.params

    const metadata = await getUploadMetadata(localId)
    if (!metadata) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
    }

    if (metadata.userId !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { parts, expiresAt } = body

    if (!Array.isArray(parts)) {
      return NextResponse.json({ error: 'Invalid parts data' }, { status: 400 })
    }

    const storageProvider = await getStorageProvider()
    await storageProvider.completeMultipartUpload(
      metadata.fileKey,
      metadata.s3UploadId,
      parts
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
        userId: user?.id,
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

    if (expiresAt) {
      try {
        const expirationDate = new Date(expiresAt)
        if (!isNaN(expirationDate.getTime()) && expirationDate > new Date()) {
          await scheduleFileExpiration(
            fileRecord.id,
            user.id,
            metadata.filename,
            expirationDate
          )
          logger.info('File expiration scheduled', {
            fileId: fileRecord.id,
            fileName: metadata.filename,
            expirationDate,
          })
        }
      } catch (error) {
        logger.error('Failed to schedule file expiration', error as Error, {
          fileId: fileRecord.id,
        })
      }
    }

    const baseUrl =
      process.env.NODE_ENV === 'development'
        ? 'http://localhost:3000'
        : process.env.NEXTAUTH_URL?.replace(/\/$/, '') || ''
    const fullUrl = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`

    const displayUrlPath = user.vanityId
      ? metadata.urlPath.replace(`/${user.urlId}/`, `/${user.vanityId}/`)
      : metadata.urlPath

    const responseData: FileUploadResponse = {
      url: `${fullUrl}${displayUrlPath}`,
      name: metadata.filename,
      size: metadata.totalSize,
      type: metadata.mimeType,
    }

    return NextResponse.json(responseData)
  } catch (error) {
    logger.error('Error completing upload', error as Error)
    return NextResponse.json(
      { error: 'Failed to complete upload' },
      { status: 500 }
    )
  }
}
