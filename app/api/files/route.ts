import { FileMetadata } from '@/types/dto/file'

import { getConfig } from '@/lib/config'
import { maxUploadBytes, storageQuotaBytes } from '@/lib/config/limits'
import { prisma } from '@/lib/database/prisma'
import { getFilesExpirationInfo } from '@/lib/events/handlers/file-expiry'
import {
  anchoredGalleryPage,
  fileListSelect,
  fileOrderBy,
} from '@/lib/files/gallery-navigation'
import { fileListFilters } from '@/lib/files/list-filters'
import { parseSingleFileUpload } from '@/lib/files/streaming-upload'
import { requireAccount } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { apiResponse, paginatedResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { hasPermission } from '@/lib/permissions/catalog'
import { rateLimit, uploadLimiter } from '@/lib/security/rate-limit'
import { type StorageProvider, getStorageProvider } from '@/lib/storage'
import {
  cleanupUncommittedUpload,
  finalizeUpload,
  prepareUploadDestination,
} from '@/lib/uploads/finalize'
import { uploadRoutes } from '@/lib/uploads/http'
import { uploadLinks } from '@/lib/uploads/links'
import {
  UploadError,
  applyUploadOverrides,
  parseUploadFields,
  requestUploadOptions,
  resolveUploadOptions,
} from '@/lib/uploads/options'

const logger = loggers.files

const api = routes('/api/files', uploadRoutes)

export const POST = api(async (request) => {
  const limited = await rateLimit(request, uploadLimiter)
  if (limited) return limited
  const user = await requireAccount(request)
  const isPaste = request.headers.get('X-Flare-Paste') === 'true'
  if (isPaste && !hasPermission(user, 'pastes.create'))
    throw new HttpError(403, 'You do not have permission to create pastes.')
  let filePath = ''
  let storage: StorageProvider | undefined
  try {
    if (!request.headers.get('content-type')?.includes('multipart/form-data'))
      throw new UploadError('Content-Type must be multipart/form-data.')
    const selection = requestUploadOptions(request)
    const initialOptions = await resolveUploadOptions(user, selection)
    const config = await getConfig()
    const maxBytes = maxUploadBytes(config)
    const quota = storageQuotaBytes(config, user)
    const quotaLimitBytes =
      quota === null
        ? Infinity
        : Math.max(0, quota / 1024 ** 2 - user.storageUsed) * 1024 ** 2
    if (quotaLimitBytes <= 0)
      throw new UploadError('You have reached your storage quota.', 413)
    storage = await getStorageProvider()
    const { upload, fields, limitHit } = await parseSingleFileUpload({
      req: request,
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
    throw error
  }
})

export const GET = api(
  async (request) => {
    const user = await requireAccount(request)

    const { searchParams } = new URL(request.url)
    const page = Number(searchParams.get('page') || '1')
    const requestedLimit = Number(searchParams.get('limit') || '24')
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(requestedLimit) ||
      requestedLimit < 1
    )
      throw new HttpError(400, 'Page and limit must be positive integers')
    const limit = Math.min(requestedLimit, 100)
    const galleryAnchor = searchParams.get('galleryAnchor')
    const galleryDirection = searchParams.get('galleryDirection')
    if (
      (galleryAnchor !== null || galleryDirection !== null) &&
      (!galleryAnchor ||
        (galleryDirection !== 'next' && galleryDirection !== 'previous'))
    )
      throw new HttpError(
        400,
        'An image anchor and a next or previous direction are required'
      )
    const sortBy = searchParams.get('sortBy') || 'newest'
    const offset = (page - 1) * limit
    if (!Number.isSafeInteger(offset))
      throw new HttpError(400, 'Page is too large')
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
      if (!resultPage) throw new HttpError(404, 'Image not found')
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
        pagination: {
          total,
          pageCount: Math.ceil(total / limit),
          page,
          limit,
        },
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
  },
  {
    envelope: 'api',
    failure: { message: 'Failed to fetch files' },
  }
)
