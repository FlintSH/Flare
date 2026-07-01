import type { Prisma } from '@prisma/client'

export interface FileQueryParams {
  search?: string
  types?: string[]
  dateFrom?: string | null
  dateTo?: string | null
  visibility?: string[]
  // A folder id, the literal 'none' for unfiled files, or undefined for all.
  folderId?: string
  // Tag ids. A file must carry every selected tag (AND semantics).
  tags?: string[]
}

/**
 * Builds the Prisma `where` clause for a user's file listing from the raw query
 * parameters. Extracted from the route handler so the (non-trivial) filtering
 * logic can be unit-tested without a database.
 */
export function buildFileWhere(
  userId: string,
  params: FileQueryParams
): Prisma.FileWhereInput {
  const where: Prisma.FileWhereInput = { userId }
  const conditions: Prisma.FileWhereInput[] = []

  const search = params.search?.trim()
  if (search) {
    conditions.push({
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { ocrText: { contains: search, mode: 'insensitive' } },
      ],
    })
  }

  if (params.types && params.types.length > 0) {
    conditions.push({ mimeType: { in: params.types } })
  }

  if (params.dateFrom || params.dateTo) {
    const dateFilter: Prisma.DateTimeFilter = {}
    if (params.dateFrom) {
      dateFilter.gte = new Date(params.dateFrom)
    }
    if (params.dateTo) {
      const endDate = new Date(params.dateTo)
      endDate.setHours(23, 59, 59, 999)
      dateFilter.lte = endDate
    }
    conditions.push({ uploadedAt: dateFilter })
  }

  if (params.visibility && params.visibility.length > 0) {
    const visibilityConditions: Prisma.FileWhereInput[] = []
    for (const filter of params.visibility) {
      if (filter === 'hasPassword') {
        visibilityConditions.push({ password: { not: null } })
      } else if (filter === 'public' || filter === 'private') {
        visibilityConditions.push({
          visibility: filter.toUpperCase() as 'PUBLIC' | 'PRIVATE',
        })
      }
    }
    if (visibilityConditions.length > 0) {
      conditions.push({ OR: visibilityConditions })
    }
  }

  if (params.folderId !== undefined && params.folderId !== '') {
    if (params.folderId === 'none') {
      conditions.push({ folderId: null })
    } else {
      conditions.push({ folderId: params.folderId })
    }
  }

  if (params.tags && params.tags.length > 0) {
    // AND semantics: the file must have a FileTag row for each selected tag.
    for (const tagId of params.tags) {
      conditions.push({ tags: { some: { tagId } } })
    }
  }

  if (conditions.length > 0) {
    where.AND = conditions
  }

  return where
}

/**
 * Maps a sort option to a Prisma `orderBy`. Defaults to newest-first.
 */
export function buildFileOrderBy(
  sortBy: string | undefined
): Prisma.FileOrderByWithRelationInput {
  switch (sortBy) {
    case 'oldest':
      return { uploadedAt: 'asc' }
    case 'largest':
      return { size: 'desc' }
    case 'smallest':
      return { size: 'asc' }
    case 'most-viewed':
      return { views: 'desc' }
    case 'least-viewed':
      return { views: 'asc' }
    case 'most-downloaded':
      return { downloads: 'desc' }
    case 'least-downloaded':
      return { downloads: 'asc' }
    case 'name-asc':
    case 'name':
      return { name: 'asc' }
    case 'name-desc':
      return { name: 'desc' }
    case 'newest':
    default:
      return { uploadedAt: 'desc' }
  }
}
