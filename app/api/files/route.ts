import { FileMetadata } from '@/types/dto/file'

import {
  HTTP_STATUS,
  apiError,
  apiResponse,
  paginatedResponse,
} from '@/lib/api/response'
import { requireAuth } from '@/lib/auth/api-auth'
import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { getFilesExpirationInfo } from '@/lib/events/handlers/file-expiry'
import {
  anchoredGalleryPage,
  fileListSelect,
  fileOrderBy,
} from '@/lib/files/gallery-navigation'
import { FileListInputError, fileListFilters } from '@/lib/files/list-filters'
import { parseSingleFileUpload } from '@/lib/files/streaming-upload'
import { loggers } from '@/lib/logger'
import { hasPermission } from '@/lib/permissions/catalog'
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
    const isPaste = req.headers.get('X-Flare-Paste') === 'true'
    if (isPaste && !hasPermission(user, 'pastes.create'))
      return apiError('You do not have permission to create pastes.', 403)
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
      limits.quotas.enabled && !hasPermission(user, 'quotas.bypass')
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
    const file = await finalizeUpload({
      user,
      storage,
      ...upload,
      options,
      isPaste,
    })
    return apiResponse(uploadLinks(file, user))
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
    const sortBy = searchParams.get('sortBy') || 'newest'
    const offset = (page - 1) * limit
    if (!Number.isSafeInteger(offset))
      return apiError('Page is too large', HTTP_STATUS.BAD_REQUEST)
    const { where } = fileListFilters(user.id, searchParams)

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

    const expirations = await getFilesExpirationInfo(
      resultPage.files.map((file) => file.id)
    )
    const filesList = resultPage.files.map((file) => {
      const { password, tags, ...publicFile } = file
      return {
        ...publicFile,
        tags: tags.map(({ tag }) => tag),
        hasPassword: Boolean(password),
        expiresAt: expirations.get(file.id) ?? null,
      }
    }) as (FileMetadata & { expiresAt: Date | null })[]

    const result = paginatedResponse<FileMetadata[]>(
      filesList,
      resultPage.pagination
    )
    result.headers.set('Cache-Control', 'private, no-store')
    return result
  } catch (error) {
    if (error instanceof FileListInputError)
      return apiError(error.message, HTTP_STATUS.BAD_REQUEST)
    logger.error('Error fetching files', error as Error)
    return apiError('Failed to fetch files', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}
