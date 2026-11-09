import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/database/prisma'
import { fileSort } from '@/lib/files/gallery-navigation'
import {
  FileListInputError,
  libraryFileFilters,
} from '@/lib/files/list-filters'
import {
  type FileTimeline,
  RELEVANCE_SORT,
  isDateOrder,
  isGrouping,
} from '@/lib/library/contract'
import type { SearchPlan } from '@/lib/search/query'

function searchMatch(search: SearchPlan | null) {
  return search
    ? { searchMatch: search.partial ? ('some' as const) : ('every' as const) }
    : {}
}

/** A database-clock read plus one aggregate; no file metadata or IDs are loaded. */
export async function fileTimeline(
  userId: string,
  params: URLSearchParams
): Promise<FileTimeline> {
  const requestedGroup = params.get('groupBy') || 'none'
  if (!isGrouping(requestedGroup))
    throw new FileListInputError('groupBy must be none, month, week, or year')
  const timezone = params.get('timezone') || 'UTC'
  try {
    if (/^[+-]/.test(timezone)) throw new Error('Expected IANA time zone')
    new Intl.DateTimeFormat('en', { timeZone: timezone })
  } catch {
    throw new FileListInputError('timezone must be a valid IANA time zone')
  }
  // Upload timestamps default to the database clock. Using that same clock
  // avoids hiding new files when a remote database is ahead of the app host.
  const [clock] = await prisma.$queryRaw<{ snapshot: Date }[]>(Prisma.sql`
    SELECT date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC') AS snapshot
  `)
  const snapshot = clock.snapshot.toISOString()
  const filters = new URLSearchParams(params)
  filters.set('snapshot', snapshot)
  const sortBy = params.get('sortBy') || 'newest'
  const sort = fileSort(sortBy)
  const undated = !isDateOrder(sort) || sortBy === RELEVANCE_SORT
  // The timeline decides whether a search lists files with every word. An
  // undated list counts both kinds in one pass, so it starts from files with
  // some of the words and keeps the narrower list when it has any files.
  if (undated) filters.set('searchMatch', 'some')
  else filters.delete('searchMatch')
  const { from, sql, search } = await libraryFileFilters(userId, filters)
  // Best match ranks a search: one bucket, like other orders not by date.
  if (!isDateOrder(sort) || (search && sortBy === RELEVANCE_SORT)) {
    const both = search?.partial
    const [{ total: count, every }] = await prisma.$queryRaw<
      { total: bigint; every: bigint | null }[]
    >(
      Prisma.sql`SELECT COUNT(*) AS total, ${
        both
          ? Prisma.sql`COUNT(*) FILTER (WHERE ${search.match})`
          : Prisma.sql`NULL`
      } AS every FROM ${from} WHERE ${sql}`
    )
    if (search && both) search.partial = !Number(every)
    const total = Number(search && both && Number(every) ? every : count)
    return {
      total,
      snapshot,
      groupBy: 'none',
      timezone,
      ...searchMatch(search),
      buckets: total
        ? [{ key: 'all', from: null, to: null, count: total, offset: 0 }]
        : [],
    }
  }

  const groupBy = requestedGroup === 'none' ? 'month' : requestedGroup
  const interval = {
    month: Prisma.sql`INTERVAL '1 month'`,
    week: Prisma.sql`INTERVAL '1 week'`,
    year: Prisma.sql`INTERVAL '1 year'`,
  }[groupBy]
  const order = sort.direction === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`
  // Prisma stores DateTime as UTC timestamp without time zone. Truncate in the
  // requested local calendar, then convert both boundaries back to UTC. PostgreSQL
  // weeks start Monday; local interval arithmetic keeps DST weeks/months correct.
  const rows = await prisma.$queryRaw<
    { from: Date; to: Date; count: bigint }[]
  >(Prisma.sql`
    SELECT (bucket AT TIME ZONE ${timezone}) AT TIME ZONE 'UTC' AS "from",
      ((bucket + ${interval}) AT TIME ZONE ${timezone}) AT TIME ZONE 'UTC' AS "to",
      COUNT(*) AS count
    FROM (
      SELECT date_trunc(${groupBy}, f."uploadedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timezone}) AS bucket
      FROM ${from} WHERE ${sql}
    ) dates
    GROUP BY bucket ORDER BY bucket ${order}
  `)
  let total = 0
  const buckets = rows.map((row) => {
    const offset = total
    const count = Number(row.count)
    total += count
    return {
      key: row.from.toISOString(),
      from: row.from.toISOString(),
      to: row.to.toISOString(),
      count,
      offset,
    }
  })
  return {
    total,
    snapshot,
    groupBy: requestedGroup,
    timezone,
    ...searchMatch(search),
    buckets,
  }
}
