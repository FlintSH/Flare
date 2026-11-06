import { prisma } from '@/lib/database/prisma'
import { getFilesExpirationInfo } from '@/lib/files/expiry'
import {
  anchoredGalleryPage,
  fileListItem,
  fileListSelect,
  fileOrderBy,
} from '@/lib/files/gallery-navigation'
import { fileListFilters } from '@/lib/files/list-filters'
import { requireAccount } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { apiResponse, paginatedResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@/lib/library/contract'
import { rateLimit, uploadLimiter } from '@/lib/security/rate-limit'
import { directUpload } from '@/lib/uploads/direct'
import { uploadRoutes } from '@/lib/uploads/http'

const api = routes('/api/files', uploadRoutes)

export const POST = api(async (request) => {
  const limited = await rateLimit(request, uploadLimiter)
  if (limited) return limited
  const user = await requireAccount(request)
  return apiResponse(await directUpload(request, user))
})

export const GET = api(
  async (request) => {
    const user = await requireAccount(request)

    const { searchParams } = new URL(request.url)
    const page = Number(searchParams.get('page') || '1')
    const requestedLimit = Number(
      searchParams.get('limit') || DEFAULT_PAGE_SIZE
    )
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(requestedLimit) ||
      requestedLimit < 1
    )
      throw new HttpError(400, 'Page and limit must be positive integers')
    const limit = Math.min(requestedLimit, MAX_PAGE_SIZE)
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
    return paginatedResponse(
      resultPage.files.map((file) =>
        fileListItem(file, expirations.get(file.id) ?? null)
      ),
      resultPage.pagination
    )
  },
  {
    envelope: 'api',
    failure: { message: 'Failed to fetch files' },
  }
)
