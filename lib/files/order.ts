import { prisma } from '@/lib/database/prisma'
import type { SortField } from '@/lib/library/contract'

import { fileSort } from './gallery-navigation'
import { fileListFilters } from './list-filters'

/**
 * The plain files of a library view as `[id, sort key]`, in pages by ID.
 *
 * For a view that the server cannot answer alone: a search, a type filter
 * or an order by name, in an account that has encrypted files
 * (docs/e2ee-spec.md, section 9.8). The owner's browser finds its encrypted
 * matches in memory, and puts both lists in one order. It never tells the
 * server which encrypted files matched.
 */
export const ORDER_PAGE_SIZE = 5000

export async function plainFileOrder(
  userId: string,
  params: URLSearchParams,
  after: string | null
) {
  const filters = new URLSearchParams(params)
  filters.set('encrypted', 'false')
  const { where } = fileListFilters(userId, filters)
  const { field } = fileSort(params.get('sortBy') || 'newest')
  const rows = await prisma.file.findMany({
    where: after ? { AND: [where, { id: { gt: after } }] } : where,
    orderBy: { id: 'asc' },
    take: ORDER_PAGE_SIZE + 1,
    select: { id: true, [field]: true } as { id: true } & Record<
      SortField,
      true
    >,
  })
  return {
    keys: rows.slice(0, ORDER_PAGE_SIZE).map((row) => {
      const key = row[field]
      return [row.id, key instanceof Date ? key.toISOString() : key] as const
    }),
    more: rows.length > ORDER_PAGE_SIZE,
  }
}
