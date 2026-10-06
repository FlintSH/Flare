import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/database/prisma'
import { FileListInputError, fileListFilters } from '@/lib/files/list-filters'

export type FileTimelineBucket = {
  key: string
  from: string | null
  to: string | null
  count: number
  offset: number
}

export type FileTimeline = {
  total: number
  snapshot: string
  groupBy: 'month' | 'week' | 'year' | 'none'
  timezone: string
  buckets: FileTimelineBucket[]
}

/** A database-clock read plus one aggregate; no file metadata or IDs are loaded. */
export async function fileTimeline(
  userId: string,
  params: URLSearchParams
): Promise<FileTimeline> {
  const requestedGroup = params.get('groupBy') || 'none'
  if (!['none', 'month', 'week', 'year'].includes(requestedGroup))
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
  const { where, sql } = fileListFilters(userId, filters)
  const sortBy = params.get('sortBy') || 'newest'
  const dateOrder = ![
    'largest',
    'smallest',
    'name',
    'most-viewed',
    'least-viewed',
    'most-downloaded',
    'least-downloaded',
  ].includes(sortBy)
  if (!dateOrder) {
    const total = await prisma.file.count({ where })
    return {
      total,
      snapshot,
      groupBy: 'none',
      timezone,
      buckets: total
        ? [{ key: 'all', from: null, to: null, count: total, offset: 0 }]
        : [],
    }
  }

  const groupBy =
    requestedGroup === 'none'
      ? 'month'
      : (requestedGroup as 'month' | 'week' | 'year')
  const interval = {
    month: Prisma.sql`INTERVAL '1 month'`,
    week: Prisma.sql`INTERVAL '1 week'`,
    year: Prisma.sql`INTERVAL '1 year'`,
  }[groupBy]
  const order = sortBy === 'oldest' ? Prisma.sql`ASC` : Prisma.sql`DESC`
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
      FROM "File" f WHERE ${sql}
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
    groupBy: requestedGroup as FileTimeline['groupBy'],
    timezone,
    buckets,
  }
}
