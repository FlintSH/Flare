import { prisma } from '@/lib/database/prisma'
import { HttpError } from '@/lib/http/errors'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@/lib/library/contract'

import { getFilesExpirationInfo } from './expiry'
import {
  anchoredGalleryPage,
  fileListItem,
  fileListSelect,
  fileOrderBy,
} from './gallery-navigation'
import { fileListFilters } from './list-filters'

/**
 * One page of an account's files as `GET /api/files` answers it: the query's
 * filters, order and paging, each file with its pending expiry. The route
 * and the MCP `search_files` tool both read from here, so they list alike.
 */
export async function fileListPage(userId: string, query: URLSearchParams) {
  const page = Number(query.get('page') || '1')
  const requestedLimit = Number(query.get('limit') || DEFAULT_PAGE_SIZE)
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(requestedLimit) ||
    requestedLimit < 1
  )
    throw new HttpError(400, 'Page and limit must be positive integers')
  const limit = Math.min(requestedLimit, MAX_PAGE_SIZE)
  const galleryAnchor = query.get('galleryAnchor')
  const galleryDirection = query.get('galleryDirection')
  if (
    (galleryAnchor !== null || galleryDirection !== null) &&
    (!galleryAnchor ||
      (galleryDirection !== 'next' && galleryDirection !== 'previous'))
  )
    throw new HttpError(
      400,
      'An image anchor and a next or previous direction are required'
    )
  const sortBy = query.get('sortBy') || 'newest'
  const offset = (page - 1) * limit
  if (!Number.isSafeInteger(offset))
    throw new HttpError(400, 'Page is too large')
  const { where } = fileListFilters(userId, query)

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
    const [total, files] = await Promise.all([
      prisma.file.count({ where }),
      prisma.file.findMany({
        where,
        // The grid and anchored navigation share the same deterministic order.
        orderBy: fileOrderBy(sortBy),
        take: limit,
        skip: offset,
        select: fileListSelect,
      }),
    ])
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
  return {
    files: resultPage.files.map((file) =>
      fileListItem(file, expirations.get(file.id) ?? null)
    ),
    pagination: resultPage.pagination,
  }
}

/** The MIME types an account's files have, in order. */
export async function accountFileTypes(userId: string): Promise<string[]> {
  // Step through the (userId, mimeType) index from one type to the next. A
  // library has a handful of types, so this reads a row for each of them
  // rather than every file.
  const rows = await prisma.$queryRaw<{ mimeType: string }[]>`
    WITH RECURSIVE types AS (
      (SELECT "mimeType" FROM "File" WHERE "userId" = ${userId}
        ORDER BY "mimeType" LIMIT 1)
      UNION ALL
      SELECT (SELECT next."mimeType" FROM "File" next
        WHERE next."userId" = ${userId} AND next."mimeType" > types."mimeType"
        ORDER BY next."mimeType" LIMIT 1)
      FROM types WHERE types."mimeType" IS NOT NULL
    )
    SELECT "mimeType" FROM types WHERE "mimeType" IS NOT NULL
  `
  return rows.map((row) => row.mimeType).sort()
}
