import {
  FileMetadata,
  FileUploadFormDataSchema,
  FileUploadResponse,
} from '@/types/dto/file'
import { Prisma } from '@prisma/client'
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
import { getUniqueFilename } from '@/lib/files/filename'
import { createRequestLogger, logError, logger } from '@/lib/logging'
import { extractUserContext } from '@/lib/logging/middleware'
import { processImageOCR } from '@/lib/ocr'
import { getStorageProvider } from '@/lib/storage'
import { bytesToMB } from '@/lib/utils'

// Helper function to get user from either session or upload token
// This has been moved to lib/auth/api-auth.ts

export async function POST(req: Request) {
  const requestLogger = createRequestLogger(req)
  const context = await extractUserContext(req)
  const startTime = Date.now()
  let filePath = ''

  try {
    logger.uploadEvent('File upload started', '', {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: requestLogger.requestId,
    })

    const { user, response } = await requireAuth(req)
    if (response) {
      logger.uploadEvent('File upload failed - authentication required', '', {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        requestId: requestLogger.requestId,
      })
      return response
    }

    const formData = await req.formData()

    // Parse and validate form data
    const uploadedFile = formData.get('file') as File
    const visibility =
      (formData.get('visibility') as 'PUBLIC' | 'PRIVATE') || 'PUBLIC'
    const password = formData.get('password') as string | null

    logger.uploadEvent('File upload request parsed', user.id, {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: requestLogger.requestId,
      metadata: {
        fileName: uploadedFile.name,
        fileSize: uploadedFile.size,
        mimeType: uploadedFile.type,
        visibility,
        hasPassword: !!password,
      },
    })

    const result = FileUploadFormDataSchema.safeParse({
      file: uploadedFile,
      visibility,
      password,
    })

    if (!result.success) {
      logger.uploadEvent('File upload failed - validation error', user.id, {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        requestId: requestLogger.requestId,
        metadata: {
          fileName: uploadedFile.name,
          validationError: result.error.issues[0].message,
        },
      })
      requestLogger.complete(400, user.id)
      return apiError(result.error.issues[0].message, HTTP_STATUS.BAD_REQUEST)
    }

    // Get config to check max upload size and quotas
    const config = await getConfig()
    const maxSize = config.settings.general.storage.maxUploadSize
    const maxBytes =
      maxSize.value * (maxSize.unit === 'GB' ? 1024 * 1024 * 1024 : 1024 * 1024)
    const quotasEnabled = config.settings.general.storage.quotas.enabled
    const defaultQuota = config.settings.general.storage.quotas.default

    if (uploadedFile.size > maxBytes) {
      logger.uploadEvent('File upload failed - file too large', user.id, {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        requestId: requestLogger.requestId,
        metadata: {
          fileName: uploadedFile.name,
          fileSize: uploadedFile.size,
          maxAllowedSize: maxBytes,
        },
      })
      requestLogger.complete(413, user.id)
      return apiError(
        `Maximum file size is ${maxSize.value}${maxSize.unit}`,
        HTTP_STATUS.PAYLOAD_TOO_LARGE
      )
    }

    // Check quota if enabled (skip for admins)
    if (quotasEnabled && user.role !== 'ADMIN') {
      const quotaMB =
        defaultQuota.value * (defaultQuota.unit === 'GB' ? 1024 : 1)
      const fileSizeMB = bytesToMB(uploadedFile.size)

      if (user.storageUsed + fileSizeMB > quotaMB) {
        logger.uploadEvent('File upload failed - quota exceeded', user.id, {
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          requestId: requestLogger.requestId,
          metadata: {
            fileName: uploadedFile.name,
            fileSize: uploadedFile.size,
            currentUsage: user.storageUsed,
            quotaLimit: quotaMB,
          },
        })
        requestLogger.complete(413, user.id)
        return apiError(
          `You have reached your storage quota of ${defaultQuota.value}${defaultQuota.unit}`,
          HTTP_STATUS.PAYLOAD_TOO_LARGE
        )
      }
    }

    // Get unique filename
    const { urlSafeName, displayName } = await getUniqueFilename(
      join('uploads', user.urlId),
      uploadedFile.name,
      user.randomizeFileUrls
    )

    // Construct paths
    filePath = join('uploads', user.urlId, urlSafeName)
    const urlPath = `/${user.urlId}/${urlSafeName}`

    // Get storage provider and upload file
    const storageProvider = await getStorageProvider()
    const bytes = await uploadedFile.arrayBuffer()
    await storageProvider.uploadFile(
      Buffer.from(bytes),
      filePath,
      uploadedFile.type
    )

    // Create database record and update storage usage in a transaction
    const fileRecord = await prisma.$transaction(async (tx) => {
      const file = await tx.file.create({
        data: {
          name: displayName,
          urlPath,
          mimeType: uploadedFile.type,
          size: bytesToMB(uploadedFile.size),
          path: filePath,
          visibility: visibility,
          password: password,
          userId: user.id,
        },
      })

      await tx.user.update({
        where: { id: user.id },
        data: {
          storageUsed: {
            increment: bytesToMB(uploadedFile.size),
          },
        },
      })

      return file
    })

    // If it's an image, trigger OCR processing in the background
    if (uploadedFile.type.startsWith('image/')) {
      logger.uploadEvent('Starting OCR processing', user.id, {
        requestId: requestLogger.requestId,
        metadata: {
          fileName: displayName,
          fileId: fileRecord.id,
        },
      })

      processImageOCR(filePath, fileRecord.id).catch((error) => {
        logError('upload', 'Background OCR processing failed', error as Error, {
          userId: user.id,
          requestId: requestLogger.requestId,
          metadata: {
            fileName: displayName,
            fileId: fileRecord.id,
          },
        })
      })
    }

    // Ensure URL has protocol and handle trailing slashes
    const baseUrl =
      process.env.NODE_ENV === 'development'
        ? 'http://localhost:3000'
        : process.env.NEXTAUTH_URL?.replace(/\/$/, '') || ''
    const fullUrl = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`

    const responseData: FileUploadResponse = {
      url: `${fullUrl}${urlPath}`,
      name: displayName,
      size: uploadedFile.size,
      type: uploadedFile.type,
    }

    const responseTime = Date.now() - startTime

    logger.uploadEvent('File upload successful', user.id, {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      responseTime,
      requestId: requestLogger.requestId,
      metadata: {
        fileName: displayName,
        fileId: fileRecord.id,
        fileSize: uploadedFile.size,
        mimeType: uploadedFile.type,
        visibility,
        hasPassword: !!password,
        storageProvider: config.settings.general.storage.provider,
      },
    })

    logger.userAction('File uploaded', user.id, {
      ipAddress: context.ipAddress,
      responseTime,
      metadata: {
        fileName: displayName,
        fileSize: uploadedFile.size,
        mimeType: uploadedFile.type,
      },
    })

    requestLogger.complete(200, user.id, {
      fileName: displayName,
      fileSize: uploadedFile.size,
    })

    return apiResponse<FileUploadResponse>(responseData)
  } catch (error) {
    const responseTime = Date.now() - startTime
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'

    logError('upload', 'File upload failed with error', error as Error, {
      userId: context.userId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      responseTime,
      requestId: requestLogger.requestId,
      metadata: {
        filePath,
      },
    })

    // Clean up the file if it was created
    if (filePath) {
      try {
        const storageProvider = await getStorageProvider()
        await storageProvider.deleteFile(filePath)
        logger.info('upload', 'File cleaned up after error', {
          userId: context.userId,
          requestId: requestLogger.requestId,
          metadata: {
            filePath,
          },
        })
      } catch (unlinkError) {
        logError(
          'upload',
          'Failed to clean up file after error',
          unlinkError as Error,
          {
            userId: context.userId,
            requestId: requestLogger.requestId,
            metadata: {
              filePath,
            },
          }
        )
      }
    }

    requestLogger.complete(500, context.userId, {
      error: errorMessage,
    })

    return apiError(errorMessage, HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}

export async function GET(request: Request) {
  const requestLogger = createRequestLogger(request)
  const context = await extractUserContext(request)
  const startTime = Date.now()

  try {
    const { user, response } = await requireAuth(request)
    if (response) {
      requestLogger.complete(401)
      return response
    }

    // parse pagination params from URL
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '24')
    const search = searchParams.get('search') || ''
    const sortBy = searchParams.get('sortBy') || 'newest'
    const types = searchParams.get('types')?.split(',') || []
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const visibilityFilters = searchParams.get('visibility')?.split(',') || []
    const offset = (page - 1) * limit

    // Build where clause for filtering
    const where: Prisma.FileWhereInput = {
      userId: user.id,
    }

    const conditions: Prisma.FileWhereInput[] = []

    if (search) {
      conditions.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { ocrText: { contains: search, mode: 'insensitive' } },
        ],
      })
    }

    if (types.length > 0) {
      conditions.push({ mimeType: { in: types } })
    }

    if (dateFrom || dateTo) {
      const dateFilter: Prisma.DateTimeFilter = {}
      if (dateFrom) {
        const startDate = new Date(dateFrom)
        dateFilter.gte = startDate

        // If dateTo is not provided, use the same date as end date
        const endDate = dateTo ? new Date(dateTo) : new Date(dateFrom)
        endDate.setHours(23, 59, 59, 999)
        dateFilter.lte = endDate
      }
      conditions.push({ uploadedAt: dateFilter })
    }

    if (visibilityFilters.length > 0) {
      const visibilityConditions = []

      for (const filter of visibilityFilters) {
        if (filter === 'hasPassword') {
          visibilityConditions.push({ password: { not: null } })
        } else {
          // Convert visibility filter to uppercase to match Prisma enum
          visibilityConditions.push({
            visibility: filter.toUpperCase() as 'PUBLIC' | 'PRIVATE',
          })
        }
      }

      conditions.push({ OR: visibilityConditions })
    }

    // Add conditions to where clause if any exist
    if (conditions.length > 0) {
      where.AND = conditions
    }

    // Build orderBy based on sortBy parameter
    const orderBy: Prisma.FileOrderByWithRelationInput = {}
    switch (sortBy) {
      case 'oldest':
        orderBy.uploadedAt = 'asc'
        break
      case 'largest':
        orderBy.size = 'desc'
        break
      case 'smallest':
        orderBy.size = 'asc'
        break
      case 'name':
        orderBy.name = 'asc'
        break
      default: // "newest"
        orderBy.uploadedAt = 'desc'
    }

    // Get total count for pagination
    const total = await prisma.file.count({ where })

    // Get files with pagination
    const files = await prisma.file.findMany({
      where,
      orderBy,
      take: limit,
      skip: offset,
      select: {
        id: true,
        name: true,
        urlPath: true,
        mimeType: true,
        size: true,
        uploadedAt: true,
        visibility: true,
        password: true,
        views: true,
        downloads: true,
        user: {
          select: {
            urlId: true,
          },
        },
      },
    })

    // Transform response to match expected type
    const filesList = files.map((file) => ({
      ...file,
      hasPassword: Boolean(file.password),
    })) as FileMetadata[]

    const pagination = {
      total,
      pageCount: Math.ceil(total / limit),
      page,
      limit,
    }

    const responseTime = Date.now() - startTime

    logger.info('api', 'Files retrieved successfully', {
      userId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      responseTime,
      requestId: requestLogger.requestId,
      metadata: {
        totalFiles: total,
        page,
        limit,
        searchQuery: search,
        filters: {
          types,
          dateFrom,
          dateTo,
          visibilityFilters,
          sortBy,
        },
      },
    })

    requestLogger.complete(200, user.id, {
      totalFiles: total,
      page,
      limit,
    })

    return paginatedResponse<FileMetadata[]>(filesList, pagination)
  } catch (error) {
    const responseTime = Date.now() - startTime

    logError('api', 'Failed to fetch files', error as Error, {
      userId: context.userId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      responseTime,
      requestId: requestLogger.requestId,
    })

    requestLogger.complete(500, context.userId, {
      error: error instanceof Error ? error.message : 'Unknown error',
    })

    return apiError('Failed to fetch files', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}
