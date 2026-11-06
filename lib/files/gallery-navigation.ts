import type { File, Prisma } from '@prisma/client'

import { prisma } from '@/lib/database/prisma'
import {
  type FileSort,
  type SortField,
  librarySort,
} from '@/lib/library/contract'

export const fileListSelect = {
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
  folderId: true,
  user: { select: { urlId: true } },
  tags: {
    where: { excluded: false },
    select: { tag: { select: { id: true, name: true } } },
    orderBy: { tag: { normalizedName: 'asc' } },
  },
} satisfies Prisma.FileSelect

/** A list row as the API sends it: tag names flat, the password reduced to a flag. */
export function fileListItem(
  {
    password,
    tags,
    ...file
  }: Prisma.FileGetPayload<{ select: typeof fileListSelect }>,
  expiresAt: Date | null
) {
  return {
    ...file,
    tags: tags.map(({ tag }) => tag),
    hasPassword: Boolean(password),
    expiresAt,
  }
}

type GalleryDirection = 'next' | 'previous'
type GalleryAnchor = Pick<File, 'id' | SortField>

/** What a `sortBy` value orders by. The API also sorts by name, which the library doesn't offer. */
export function fileSort(sortBy: string): FileSort {
  return sortBy === 'name'
    ? { field: 'name', direction: 'asc' }
    : librarySort(sortBy)
}

export function fileOrderBy(
  sortBy: string,
  reverse = false
): Prisma.FileOrderByWithRelationInput[] {
  const sort = fileSort(sortBy)
  return [
    {
      [sort.field]: reverse
        ? sort.direction === 'asc'
          ? 'desc'
          : 'asc'
        : sort.direction,
    },
    { id: reverse ? 'desc' : 'asc' },
  ]
}

function galleryBoundary(
  anchor: GalleryAnchor,
  sort: FileSort,
  direction: GalleryDirection
): Prisma.FileWhereInput {
  const comparison =
    (direction === 'next') === (sort.direction === 'asc') ? 'gt' : 'lt'
  return {
    OR: [
      { [sort.field]: { [comparison]: anchor[sort.field] } },
      {
        [sort.field]: anchor[sort.field],
        id: { [direction === 'next' ? 'gt' : 'lt']: anchor.id },
      },
    ],
  }
}

/** Resolve neighbors from the current image, even after rows shift pages. */
export function anchoredGalleryPage({
  where,
  sortBy,
  anchorId,
  direction,
  limit,
}: {
  where: Prisma.FileWhereInput
  sortBy: string
  anchorId: string
  direction: GalleryDirection
  limit: number
}) {
  const imagesWhere: Prisma.FileWhereInput = {
    AND: [where, { mimeType: { startsWith: 'image/' } }],
  }
  const sort = fileSort(sortBy)
  return prisma.$transaction(
    async (transaction) => {
      // Checking the anchor within the same owner and filters avoids revealing
      // whether an inaccessible or now-filtered image exists.
      const anchor = await transaction.file.findFirst({
        where: { AND: [imagesWhere, { id: anchorId }] },
        select: {
          id: true,
          uploadedAt: true,
          size: true,
          views: true,
          downloads: true,
          name: true,
        },
      })
      if (!anchor) return null

      const [total, beforeAnchor, neighbors] = await Promise.all([
        transaction.file.count({ where: imagesWhere }),
        transaction.file.count({
          where: {
            AND: [imagesWhere, galleryBoundary(anchor, sort, 'previous')],
          },
        }),
        transaction.file.findMany({
          where: {
            AND: [imagesWhere, galleryBoundary(anchor, sort, direction)],
          },
          orderBy: fileOrderBy(sortBy, direction === 'previous'),
          take: limit,
          select: fileListSelect,
        }),
      ])
      const files = direction === 'previous' ? neighbors.reverse() : neighbors
      // At a boundary the client keeps the current image, so report its rank.
      const offset =
        files.length === 0
          ? beforeAnchor
          : direction === 'next'
            ? beforeAnchor + 1
            : beforeAnchor - files.length
      return {
        files,
        pagination: {
          total,
          page: Math.floor(offset / limit) + 1,
          pageCount: Math.ceil(total / limit),
          limit,
          offset,
        },
      }
    },
    { isolationLevel: 'RepeatableRead' }
  )
}
