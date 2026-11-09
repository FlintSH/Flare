import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/database/prisma'
import { fileSort } from '@/lib/files/gallery-navigation'
import { RELEVANCE_SORT } from '@/lib/library/contract'

import type { SearchPlan } from './query'

const COLUMNS = {
  uploadedAt: Prisma.raw('f."uploadedAt"'),
  size: Prisma.raw('f.size'),
  views: Prisma.raw('f.views'),
  downloads: Prisma.raw('f.downloads'),
  name: Prisma.raw('f.name'),
} as const

/**
 * A search's order: by relevance, newest first among equals, or by a column
 * like a list without a search. The file ID breaks every tie, so pages and
 * gallery neighbors never overlap.
 */
export function searchOrder(plan: SearchPlan, sortBy: string): Prisma.Sql {
  if (sortBy === RELEVANCE_SORT)
    return Prisma.sql`${plan.score} DESC, f."uploadedAt" DESC, f.id ASC`
  const sort = fileSort(sortBy)
  return Prisma.sql`${COLUMNS[sort.field]} ${Prisma.raw(sort.direction === 'asc' ? 'ASC' : 'DESC')}, f.id ASC`
}

/** One page of matching file IDs, in order, and how many match in all. */
export async function searchPage({
  plan,
  sql,
  sortBy,
  limit,
  offset,
}: {
  plan: SearchPlan
  sql: Prisma.Sql
  sortBy: string
  limit: number
  offset: number
}) {
  // In parallel, on separate connections: a count, and a page that keeps
  // only its top rows while sorting.
  const [[{ total }], rows] = await Promise.all([
    prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total FROM ${plan.from} WHERE ${sql}
    `,
    prisma.$queryRaw<{ id: string }[]>`
      SELECT f.id FROM ${plan.from} WHERE ${sql}
      ORDER BY ${searchOrder(plan, sortBy)}
      LIMIT ${limit} OFFSET ${offset}
    `,
  ])
  return { ids: rows.map((row) => row.id), total: Number(total) }
}

/**
 * Images next to an anchor in a search's order, like the gallery outside a
 * search: up to `limit` after (or before) it, with its rank among all
 * matching images. Null when the anchor isn't a matching image of the owner.
 */
export async function searchGalleryPage({
  plan,
  sql,
  sortBy,
  anchorId,
  direction,
  limit,
}: {
  plan: SearchPlan
  sql: Prisma.Sql
  sortBy: string
  anchorId: string
  direction: 'next' | 'previous'
  limit: number
}) {
  const rows = await prisma.$queryRaw<
    { id: string; rank: bigint; total: bigint }[]
  >`
    WITH ranked AS (
      SELECT f.id, ROW_NUMBER() OVER (ORDER BY ${searchOrder(plan, sortBy)}) AS rank,
        COUNT(*) OVER () AS total
      FROM ${plan.from} WHERE ${sql} AND f."mimeType" LIKE 'image/%'
    ), anchor AS (SELECT rank FROM ranked WHERE id = ${anchorId})
    SELECT ranked.id, ranked.rank, ranked.total
    FROM anchor JOIN ranked ON ${
      direction === 'next'
        ? Prisma.sql`ranked.rank > anchor.rank AND ranked.rank <= anchor.rank + ${limit}`
        : Prisma.sql`ranked.rank < anchor.rank AND ranked.rank >= anchor.rank - ${limit}`
    } OR ranked.id = ${anchorId}
    ORDER BY ranked.rank
  `
  const anchor = rows.find((row) => row.id === anchorId)
  if (!anchor) return null
  const ids = rows.filter((row) => row.id !== anchorId).map((row) => row.id)
  const total = Number(anchor.total)
  const beforeAnchor = Number(anchor.rank) - 1
  // At a boundary the client keeps the current image, so report its rank.
  const offset = !ids.length
    ? beforeAnchor
    : direction === 'next'
      ? beforeAnchor + 1
      : beforeAnchor - ids.length
  return {
    ids,
    pagination: {
      total,
      page: Math.floor(offset / limit) + 1,
      pageCount: Math.ceil(total / limit),
      limit,
      offset,
    },
  }
}
