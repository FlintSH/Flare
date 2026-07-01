import {
  FileMetadata,
  FileUploadResponse,
  FileVisibility,
} from '@/types/dto/file'
import { hash } from 'bcryptjs'
import { join } from 'path'

import {
  HTTP_STATUS,
  apiError,
  apiResponse,
  paginatedResponse,
} from '@/lib/api/response'
import { requireAuth } from '@/lib/auth/api-auth'
import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import {
  getFileExpirationInfo,
  scheduleFileExpiration,
} from '@/lib/events/handlers/file-expiry'
import { getUniqueFilename } from '@/lib/files/filename'
import { buildFileOrderBy, buildFileWhere } from '@/lib/files/query'
import { fileListSelect, serializeFile } from '@/lib/files/serialize'
import { parseSingleFileUpload } from '@/lib/files/streaming-upload'
import { loggers } from '@/lib/logger'
import { processImageOCR } from '@/lib/ocr'
import { resolveUploadOrganization } from '@/lib/organization/upload'
import { validateFileType } from '@/lib/security/file-validation'
import { rateLimit, uploadLimiter } from '@/lib/security/rate-limit'
import { getStorageProvider } from '@/lib/storage'
import { bytesToMB } from '@/lib/utils'

const logger = loggers.files

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const limited = await rateLimit(req, uploadLimiter)
  if (limited) return limited

  let filePath = ''
  let userId: string | undefined

  try {
    const { user, response } = await requireAuth(req)
    userId = user?.id
    if (response) return response

    const contentType = req.headers.get('content-type') || ''
    if (!contentType.includes('multipart/form-data')) {
      return apiError(
        'Content-Type must be multipart/form-data',
        HTTP_STATUS.BAD_REQUEST
      )
    }

    const config = await getConfig()
    const maxSize = config.settings.general.storage.maxUploadSize
    const maxBytes =
      maxSize.value * (maxSize.unit === 'GB' ? 1024 * 1024 * 1024 : 1024 * 1024)
    const quotasEnabled = config.settings.general.storage.quotas.enabled
    const defaultQuota = config.settings.general.storage.quotas.default

    let quotaLimitBytes = Number.POSITIVE_INFINITY
    if (quotasEnabled && user.role !== 'ADMIN') {
      const quotaMB =
        defaultQuota.value * (defaultQuota.unit === 'GB' ? 1024 : 1)
      const remainingMB = quotaMB - user.storageUsed
      quotaLimitBytes = Math.max(0, remainingMB) * 1024 * 1024
    }

    if (quotaLimitBytes <= 0) {
      return apiError(
        `You have reached your storage quota of ${defaultQuota.value}${defaultQuota.unit}`,
        HTTP_STATUS.PAYLOAD_TOO_LARGE
      )
    }

    const storageProvider = await getStorageProvider()

    const { upload, fields, limitHit } = await parseSingleFileUpload({
      req,
      storageProvider,
      maxBytes,
      quotaLimitBytes,
      resolveDestination: async ({ filename }) => {
        const { urlSafeName, displayName } = await getUniqueFilename(
          join('uploads', user.urlId),
          filename,
          user.randomizeFileUrls
        )

        filePath = join('uploads', user.urlId, urlSafeName)

        return {
          filePath,
          urlPath: `/${user.urlId}/${urlSafeName}`,
          displayName,
          urlSafeName,
        }
      },
    })

    const cleanupPartialUpload = async () => {
      if (!filePath) return
      try {
        await storageProvider.deleteFile(filePath)
      } catch (unlinkError) {
        logger.debug('No partial upload to clean up', {
          filePath,
          error: unlinkError,
        })
      }
    }

    if (limitHit === 'quota') {
      await cleanupPartialUpload()
      return apiError(
        `You have reached your storage quota of ${defaultQuota.value}${defaultQuota.unit}`,
        HTTP_STATUS.PAYLOAD_TOO_LARGE
      )
    }

    if (limitHit === 'size') {
      await cleanupPartialUpload()
      return apiError(
        `Maximum file size is ${maxSize.value}${maxSize.unit}`,
        HTTP_STATUS.PAYLOAD_TOO_LARGE
      )
    }

    if (!upload) {
      return apiError('No file provided', HTTP_STATUS.BAD_REQUEST)
    }

    const visibility =
      fields.visibility === FileVisibility.PRIVATE
        ? FileVisibility.PRIVATE
        : FileVisibility.PUBLIC
    const password = fields.password || null
    const expiresAt = fields.expiresAt || null

    let expirationDate: Date | null = null
    if (expiresAt) {
      expirationDate = new Date(expiresAt)
      if (isNaN(expirationDate.getTime()) || expirationDate <= new Date()) {
        await cleanupPartialUpload()
        return apiError(
          'Invalid expiration date. Must be in the future.',
          HTTP_STATUS.BAD_REQUEST
        )
      }
    }

    const { displayName, urlPath, mimeType, size, urlSafeName } = upload

    const { folderId, tagIds } = await resolveUploadOrganization(
      user.id,
      fields.folderId || null,
      fields.tags ? fields.tags.split(',') : undefined
    )

    // Validate the real file type against the claimed MIME using only the header
    // bytes read back from storage, so we never buffer the whole file in memory.
    const headStream = await storageProvider.getFileStream(filePath, {
      start: 0,
      end: 4099,
    })
    const headChunks: Buffer[] = []
    for await (const chunk of headStream) {
      headChunks.push(Buffer.from(chunk))
    }
    const typeCheck = await validateFileType(
      Buffer.concat(headChunks),
      mimeType
    )
    if (!typeCheck.valid) {
      logger.warn('File type mismatch on upload', {
        claimed: mimeType,
        detected: typeCheck.detectedType,
        userId: user.id,
      })
      await cleanupPartialUpload()
      return apiError(
        `File type mismatch: detected ${typeCheck.detectedType}, claimed ${mimeType}`,
        HTTP_STATUS.BAD_REQUEST
      )
    }

    const fileRecord = await prisma.$transaction(async (tx) => {
      const file = await tx.file.create({
        data: {
          name: displayName,
          urlPath,
          mimeType,
          size: bytesToMB(size),
          path: filePath,
          visibility,
          password: password ? await hash(password, 10) : null,
          userId: user.id,
          folderId,
          ...(tagIds.length > 0 && {
            tags: { create: tagIds.map((tagId) => ({ tagId })) },
          }),
        },
      })

      await tx.user.update({
        where: { id: user.id },
        data: {
          storageUsed: {
            increment: bytesToMB(size),
          },
        },
      })

      return file
    })

    if (mimeType.startsWith('image/')) {
      processImageOCR(filePath, fileRecord.id).catch((error) => {
        logger.error('Background OCR processing failed', error as Error, {
          fileId: fileRecord.id,
          filePath,
        })
      })
    }

    if (expirationDate) {
      try {
        await scheduleFileExpiration(
          fileRecord.id,
          user.id,
          displayName,
          expirationDate
        )
        logger.info('File expiration scheduled', {
          fileId: fileRecord.id,
          fileName: displayName,
          expirationDate,
        })
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
      ? `/${user.vanityId}/${urlSafeName}`
      : urlPath

    const responseData: FileUploadResponse = {
      url: `${fullUrl}${displayUrlPath}`,
      name: displayName,
      size,
      type: mimeType,
    }

    return apiResponse<FileUploadResponse>(responseData)
  } catch (error) {
    logger.error('Upload error', error as Error, {
      userId,
    })

    if (filePath) {
      try {
        const storageProvider = await getStorageProvider()
        await storageProvider.deleteFile(filePath)
        logger.info('Cleaned up file after error', { filePath })
      } catch (unlinkError) {
        logger.error('Failed to clean up file', unlinkError as Error, {
          filePath,
        })
      }
    }

    return apiError(
      'An unexpected error occurred',
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    )
  }
}

export async function GET(request: Request) {
  try {
    const { user, response } = await requireAuth(request)
    if (response) return response

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '24')
    const sortBy = searchParams.get('sortBy') || 'newest'
    const offset = (page - 1) * limit

    const where = buildFileWhere(user.id, {
      search: searchParams.get('search') || '',
      types: searchParams.get('types')?.split(',').filter(Boolean) || [],
      dateFrom: searchParams.get('dateFrom'),
      dateTo: searchParams.get('dateTo'),
      visibility:
        searchParams.get('visibility')?.split(',').filter(Boolean) || [],
      folderId: searchParams.get('folderId') ?? undefined,
      tags: searchParams.get('tags')?.split(',').filter(Boolean) || [],
    })

    const orderBy = buildFileOrderBy(sortBy)

    const total = await prisma.file.count({ where })

    const files = await prisma.file.findMany({
      where,
      orderBy,
      take: limit,
      skip: offset,
      select: fileListSelect,
    })

    const filesList: FileMetadata[] = await Promise.all(
      files.map(async (file) => {
        const expiresAt = await getFileExpirationInfo(file.id)
        return serializeFile(file, expiresAt)
      })
    )

    const pagination = {
      total,
      pageCount: Math.ceil(total / limit),
      page,
      limit,
    }

    return paginatedResponse<FileMetadata[]>(filesList, pagination)
  } catch (error) {
    logger.error('Error fetching files', error as Error)
    return apiError('Failed to fetch files', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}
