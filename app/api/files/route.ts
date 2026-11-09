import { prisma } from '@/lib/database/prisma'
import { getFilesExpirationInfo } from '@/lib/files/expiry'
import {
  anchoredGalleryPage,
  fileListItem,
  fileListSelect,
  fileOrderBy,
} from '@/lib/files/gallery-navigation'
import { libraryFileFilters } from '@/lib/files/list-filters'
import { requireAccount } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { apiResponse, paginatedResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@/lib/library/contract'
import { searchGalleryPage, searchPage } from '@/lib/search/list'
import { explainMatches } from '@/lib/search/query'
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
    const filters = await libraryFileFilters(user.id, searchParams)

    let resultPage
    if (filters.search) {
      // A search is ordered and paged in SQL, then read like any list.
      const plan = filters.search
      const found =
        galleryAnchor && galleryDirection
          ? await searchGalleryPage({
              plan,
              sql: filters.sql,
              sortBy,
              anchorId: galleryAnchor,
              direction: galleryDirection,
              limit,
            })
          : await searchPage({
              plan,
              sql: filters.sql,
              sortBy,
              limit,
              offset,
            }).then(({ ids, total }) => ({
              ids,
              pagination: {
                total,
                pageCount: Math.ceil(total / limit),
                page,
                limit,
              },
            }))
      if (!found) throw new HttpError(404, 'Image not found')
      const rows = await prisma.file.findMany({
        where: { id: { in: found.ids }, userId: user.id },
        select: fileListSelect,
      })
      const byId = new Map(rows.map((row) => [row.id, row]))
      resultPage = {
        files: found.ids.flatMap((id) => byId.get(id) ?? []),
        pagination: found.pagination,
      }
    } else if (galleryAnchor && galleryDirection) {
      resultPage = await anchoredGalleryPage({
        where: filters.where,
        sortBy,
        anchorId: galleryAnchor,
        direction: galleryDirection,
        limit,
      })
      if (!resultPage) throw new HttpError(404, 'Image not found')
    } else {
      const where = filters.where
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

    const [expirations, matches] = await Promise.all([
      getFilesExpirationInfo(resultPage.files.map((file) => file.id)),
      filters.search
        ? explainMatches(
            filters.search,
            resultPage.files.map((file) => ({
              id: file.id,
              folderId: file.folderId,
              tags: file.tags.map(({ tag }) => tag),
            }))
          )
        : null,
    ])
    return paginatedResponse(
      resultPage.files.map((file) => ({
        ...fileListItem(file, expirations.get(file.id) ?? null),
        ...(matches && { match: matches.get(file.id) ?? null }),
      })),
      resultPage.pagination
    )
  },
  {
    envelope: 'api',
    failure: { message: 'Failed to fetch files' },
  }
)
