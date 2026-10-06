import type { FileGrouping } from '@/types/components/file'

export interface TimelineBucket {
  key: string
  from: string | null
  to: string | null
  count: number
  offset: number
}

export interface FileTimeline {
  total: number
  snapshot: string
  groupBy: FileGrouping
  timezone: string
  buckets: TimelineBucket[]
}

export const TIMELINE_PAGE_SIZE = 48
export const TIMELINE_CACHE_PAGES = 12
// Stay below browser scroll-height limits, including single-column phone layouts.
export const TIMELINE_WINDOW_ROWS = 8000
export function timelineWindowStart(row: number, totalRows: number) {
  return Math.max(
    0,
    Math.min(
      totalRows - TIMELINE_WINDOW_ROWS,
      row - Math.floor(TIMELINE_WINDOW_ROWS / 2)
    )
  )
}

/** Binary search keeps the layout proportional to date groups, not file count. */
export function bucketAt(buckets: TimelineBucket[], index: number) {
  let low = 0
  let high = buckets.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (buckets[mid].offset <= index) low = mid
    else high = mid - 1
  }
  return buckets[low]
}

export function timelinePage(bucket: TimelineBucket, index: number) {
  const page = Math.floor((index - bucket.offset) / TIMELINE_PAGE_SIZE) + 1
  return { key: `${bucket.key}:${page}`, bucket, page }
}

export function timelineLayout(
  timeline: FileTimeline,
  columns: number,
  grouped: boolean
) {
  let rowCount = 0
  const groups = timeline.buckets.map((bucket) => {
    const start = rowCount
    rowCount += 1 + Math.ceil(bucket.count / columns)
    return { bucket, start, end: rowCount }
  })
  if (!grouped) rowCount = Math.ceil(timeline.total / columns)
  function groupAt(row: number) {
    let low = 0
    let high = groups.length - 1
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (groups[mid].start <= row) low = mid
      else high = mid - 1
    }
    return groups[low]
  }
  return {
    rowCount,
    rowAt(index: number) {
      if (!grouped) return Math.floor(index / columns)
      const bucket = bucketAt(timeline.buckets, index)
      const group = groups.find((entry) => entry.bucket === bucket)!
      return group.start + 1 + Math.floor((index - bucket.offset) / columns)
    },
    row(row: number) {
      const group = grouped ? groupAt(row) : null
      if (group && row === group.start)
        return { heading: group.bucket, indices: [] as number[] }
      const first = group
        ? group.bucket.offset + (row - group.start - 1) * columns
        : row * columns
      const end = group
        ? group.bucket.offset + group.bucket.count
        : timeline.total
      return {
        heading: null,
        indices: Array.from(
          { length: Math.max(0, Math.min(columns, end - first)) },
          (_, column) => first + column
        ),
      }
    },
  }
}

export function bucketLabel(
  bucket: TimelineBucket,
  grouping: FileGrouping,
  timezone: string
) {
  if (!bucket.from) return 'All files'
  const date = new Date(bucket.from)
  const label = new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    year: 'numeric',
    ...(grouping !== 'year' && { month: 'long' }),
    ...(grouping === 'week' && { day: 'numeric' }),
  }).format(date)
  return grouping === 'week' ? `Week of ${label}` : label
}
