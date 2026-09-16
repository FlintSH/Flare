import { FileMetadata } from '@/types/dto/file'
import { Prisma } from '@prisma/client'

import {
  HTTP_STATUS,
  apiError,
  apiResponse,
  paginatedResponse,
} from '@/lib/api/response'
import { requireAuth } from '@/lib/auth/api-auth'
import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { getFileExpirationInfo } from '@/lib/events/handlers/file-expiry'
import {
  anchoredGalleryPage,
  fileListSelect,
  fileOrderBy,
} from '@/lib/files/gallery-navigation'
import { parseSingleFileUpload } from '@/lib/files/streaming-upload'
import { loggers } from '@/lib/logger'
import { rateLimit, uploadLimiter } from '@/lib/security/rate-limit'
import { type StorageProvider, getStorageProvider } from '@/lib/storage'
import {
  cleanupUncommittedUpload,
  finalizeUpload,
  prepareUploadDestination,
} from '@/lib/uploads/finalize'
import { uploadLinks } from '@/lib/uploads/links'
import {
  UploadError,
  applyUploadOverrides,
  parseUploadFields,
  requestUploadOptions,
  resolveUploadOptions,
  uploadErrorResponse,
} from '@/lib/uploads/options'

const logger = loggers.files
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const limited = await rateLimit(req, uploadLimiter)
  if (limited) return limited
  let filePath = ''
  let storage: StorageProvider | undefined
  try {
    const { user, response } = await requireAuth(req)
    if (response) return response
    if (!req.headers.get('content-type')?.includes('multipart/form-data'))
      throw new UploadError('Content-Type must be multipart/form-data.')
    const selection = requestUploadOptions(req)
    const initialOptions = await resolveUploadOptions(user, selection)
    const config = await getConfig()
    const limits = config.settings.general.storage
    const maxBytes =
      limits.maxUploadSize.value *
      (limits.maxUploadSize.unit === 'GB' ? 1024 ** 3 : 1024 ** 2)
    const quotaMB =
      limits.quotas.default.value *
      (limits.quotas.default.unit === 'GB' ? 1024 : 1)
    const quotaLimitBytes =
      limits.quotas.enabled && user.role !== 'ADMIN'
        ? Math.max(0, quotaMB - user.storageUsed) * 1024 ** 2
        : Infinity
    if (quotaLimitBytes <= 0)
      throw new UploadError('You have reached your storage quota.', 413)
    storage = await getStorageProvider()
    const { upload, fields, limitHit } = await parseSingleFileUpload({
      req,
      storageProvider: storage,
      maxBytes,
      quotaLimitBytes,
      resolveDestination: async ({ filename }) => {
        const destination = await prepareUploadDestination(
          user,
          filename,
          initialOptions
        )
        filePath = destination.filePath
        return destination
      },
    })
    if (limitHit)
      throw new UploadError(
        limitHit === 'quota'
          ? 'The file would exceed your storage quota.'
          : 'The file exceeds the upload size limit.',
        413
      )
    if (!upload) throw new UploadError('No file provided.')
    const overrides = parseUploadFields(fields)
    // Profile and naming are fixed before any bytes are written. Other fields remain
    // compatible with existing multipart clients regardless of field ordering.
    if (
      overrides.profileId !== undefined &&
      overrides.profileId !== initialOptions.profileId
    )
      throw new UploadError(
        'Select the profile using X-Upload-Profile before uploading.'
      )
    if (
      overrides.randomizeFileUrls !== undefined &&
      overrides.randomizeFileUrls !== initialOptions.randomizeFileUrls
    )
      throw new UploadError('Select a naming strategy in your upload profile.')
    const options = applyUploadOverrides(user, initialOptions, overrides)
    const file = await finalizeUpload({ user, storage, ...upload, options })
    return apiResponse(uploadLinks(file, user, options))
  } catch (error) {
    if (storage && filePath) await cleanupUncommittedUpload(storage, filePath)
    logger.error('Upload failed', error as Error)
    return uploadErrorResponse(error)
  }
}

export async function GET(request: Request) {
  try {
    const { user, response } = await requireAuth(request)
    if (response) return response

    const { searchParams } = new URL(request.url)
    const page = Number(searchParams.get('page') || '1')
    const requestedLimit = Number(searchParams.get('limit') || '24')
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(requestedLimit) ||
      requestedLimit < 1
    )
      return apiError(
        'Page and limit must be positive integers',
        HTTP_STATUS.BAD_REQUEST
      )
    const limit = Math.min(requestedLimit, 100)
    const galleryAnchor = searchParams.get('galleryAnchor')
    const galleryDirection = searchParams.get('galleryDirection')
    if (
      (galleryAnchor !== null || galleryDirection !== null) &&
      (!galleryAnchor ||
        (galleryDirection !== 'next' && galleryDirection !== 'previous'))
    )
      return apiError(
        'An image anchor and a next or previous direction are required',
        HTTP_STATUS.BAD_REQUEST
      )
    const search = searchParams.get('search') || ''
    const sortBy = searchParams.get('sortBy') || 'newest'
    const types = searchParams.get('types')?.split(',') || []
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const visibilityFilters = searchParams.get('visibility')?.split(',') || []
    const offset = (page - 1) * limit

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
      }
      if (dateTo) {
        // The picker supplies the end of the selected day in the user's
        // timezone. Preserve that instant instead of shifting it to server time.
        const endDate = new Date(dateTo)
        // Keep date-only API requests inclusive of their final day.
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
          endDate.setHours(23, 59, 59, 999)
        }
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
          visibilityConditions.push({
            visibility: filter.toUpperCase() as 'PUBLIC' | 'PRIVATE',
          })
        }
      }

      conditions.push({ OR: visibilityConditions })
    }

    if (conditions.length > 0) {
      where.AND = conditions
    }

    let resultPage
    if (galleryAnchor && galleryDirection) {
      resultPage = await anchoredGalleryPage({
        where,
        sortBy,
        anchorId: galleryAnchor,
        direction: galleryDirection,
        limit,
      })
      if (!resultPage) return apiError('Image not found', HTTP_STATUS.NOT_FOUND)
    } else {
      const total = await prisma.file.count({ where })
      const files = await prisma.file.findMany({
        where,
        // The grid and anchored navigation share the same deterministic order.
        orderBy: fileOrderBy(sortBy),
        take: limit,
        skip: offset,
        select: fileListSelect,
      })
      resultPage = {
        files,
        pagination: { total, pageCount: Math.ceil(total / limit), page, limit },
      }
    }

    const filesList = (await Promise.all(
      resultPage.files.map(async (file) => {
        const expiresAt = await getFileExpirationInfo(file.id)
        const { password, ...publicFile } = file
        return {
          ...publicFile,
          hasPassword: Boolean(password),
          expiresAt,
        }
      })
    )) as (FileMetadata & { expiresAt: Date | null })[]

    const result = paginatedResponse<FileMetadata[]>(
      filesList,
      resultPage.pagination
    )
    result.headers.set('Cache-Control', 'private, no-store')
    return result
  } catch (error) {
    logger.error('Error fetching files', error as Error)
    return apiError('Failed to fetch files', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}
