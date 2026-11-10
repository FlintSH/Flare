import {
  type FileSort,
  type FileTimeline,
  type FileTimelineBucket,
  UNFILED,
  UNTAGGED,
} from './contract'

/**
 * Search over the encrypted files of the owner, in the browser
 * (docs/e2ee-spec.md, section 9.8). The server cannot read their names,
 * types or image text, so a worker opens the records into memory and tests
 * them there: the same test for a substring without regard to case that the
 * server does for plain files, and the same filters.
 *
 * This module is the part without a browser: what a file of the index is,
 * how a view selects and orders files, and how the client's matches and the
 * server's matches become one list. No DOM and no storage.
 */

/** The visible values of one encrypted file, as the sync endpoint sends them. */
export interface IndexedRow {
  readonly id: string
  readonly uploadedAt: string
  readonly size: number
  readonly views: number
  readonly downloads: number
  readonly visibility: 'PUBLIC' | 'PRIVATE'
  readonly hasPassword: boolean
  readonly folderId?: string | null
  readonly tags?: readonly { readonly id: string }[]
}

/** One encrypted file as the worker holds it: plaintext in memory only. */
export interface IndexedFile<Row extends IndexedRow = IndexedRow> {
  readonly row: Row
  readonly name: string
  readonly type: string
  /** The name and the text of the image in lower case, for the search. */
  readonly nameLower: string
  /** Null when no text is stored for the file. */
  readonly textLower: string | null
}

export function indexedFile<Row extends IndexedRow>(
  row: Row,
  opened: { name: string; type: string; text: string | null }
): IndexedFile<Row> {
  return {
    row,
    name: opened.name,
    type: opened.type,
    nameLower: opened.name.toLowerCase(),
    textLower: opened.text === null ? null : opened.text.toLowerCase(),
  }
}

/** The part of a library view that selects and orders files. */
export interface ViewQuery {
  readonly search: string
  readonly types: readonly string[]
  readonly folder: string | null
  readonly tag: string | null
  readonly visibility: readonly string[]
  readonly dateFrom: string | null
  readonly dateTo: string | null
  readonly sort: FileSort
}

/**
 * Whether a view needs the client: the server cannot search, filter by type
 * or sort by name where the names and types are encrypted (section 9.3).
 */
export function needsClient(query: ViewQuery): boolean {
  return (
    query.search !== '' || query.types.length > 0 || query.sort.field === 'name'
  )
}

/** Whether the server's own filters select this file. The same rules as `fileListFilters`. */
export function matchesQuery(file: IndexedFile, query: ViewQuery): boolean {
  const { row } = file
  if (query.search) {
    // The server tests the name column and the text column: so does this.
    const needle = query.search.toLowerCase()
    if (
      !file.nameLower.includes(needle) &&
      !(file.textLower !== null && file.textLower.includes(needle))
    )
      return false
  }
  if (query.types.length && !query.types.includes(file.type)) return false
  if (query.folder) {
    if (query.folder === UNFILED ? row.folderId : row.folderId !== query.folder)
      return false
  }
  if (query.tag) {
    const tags = row.tags ?? []
    if (
      query.tag === UNTAGGED
        ? tags.length > 0
        : !tags.some((tag) => tag.id === query.tag)
    )
      return false
  }
  if (query.visibility.length) {
    const any = query.visibility.some((value) =>
      value === 'hasPassword'
        ? row.hasPassword
        : row.visibility === value.toUpperCase()
    )
    if (!any) return false
  }
  if (query.dateFrom && row.uploadedAt < toIso(query.dateFrom)) return false
  if (query.dateTo && row.uploadedAt > toIso(query.dateTo)) return false
  return true
}

/** ISO timestamps compare as text only in their one canonical form. */
function toIso(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

export type SortKey = string | number

/** One file of a merged list: where its row comes from, and what it sorts by. */
export interface OrderedEntry {
  readonly id: string
  readonly encrypted: boolean
  readonly key: SortKey
}

export function sortKeyOf(
  file: IndexedFile,
  field: FileSort['field']
): SortKey {
  if (field === 'name') return file.name
  if (field === 'uploadedAt') return toIso(file.row.uploadedAt)
  return file.row[field]
}

const names = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

/**
 * The order of a view: the sort key in its direction, then the ID. One
 * comparison serves both the server's entries and the client's, so the two
 * interleave exactly.
 */
export function compareEntries(sort: FileSort) {
  const direction = sort.direction === 'asc' ? 1 : -1
  return (a: OrderedEntry, b: OrderedEntry): number => {
    const order =
      typeof a.key === 'string' && typeof b.key === 'string'
        ? sort.field === 'name'
          ? names.compare(a.key, b.key)
          : a.key < b.key
            ? -1
            : a.key > b.key
              ? 1
              : 0
        : Number(a.key) - Number(b.key)
    return order * direction || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  }
}

/** The encrypted files that a view selects, each with its sort key. Not ordered. */
export function queryIndex(
  files: Iterable<IndexedFile>,
  query: ViewQuery
): OrderedEntry[] {
  const entries: OrderedEntry[] = []
  for (const file of files)
    if (matchesQuery(file, query))
      entries.push({
        id: file.row.id,
        encrypted: true,
        key: sortKeyOf(file, query.sort.field),
      })
  return entries
}

/** The client's matches and the server's matches as one ordered list. */
export function mergeEntries(
  sort: FileSort,
  plain: readonly (readonly [string, SortKey])[],
  encrypted: readonly OrderedEntry[]
): OrderedEntry[] {
  const merged: OrderedEntry[] = plain.map(([id, key]) => ({
    id,
    encrypted: false,
    key: sort.field === 'uploadedAt' ? toIso(String(key)) : key,
  }))
  for (const entry of encrypted) merged.push(entry)
  return merged.sort(compareEntries(sort))
}

type Grouping = FileTimeline['groupBy']

/** The start of the local calendar span that holds `date`. Weeks start on Monday, as in PostgreSQL. */
function spanStart(date: Date, span: 'month' | 'week' | 'year'): Date {
  if (span === 'year') return new Date(date.getFullYear(), 0, 1)
  if (span === 'month') return new Date(date.getFullYear(), date.getMonth(), 1)
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  return start
}

function spanEnd(start: Date, span: 'month' | 'week' | 'year'): Date {
  if (span === 'year') return new Date(start.getFullYear() + 1, 0, 1)
  if (span === 'month')
    return new Date(start.getFullYear(), start.getMonth() + 1, 1)
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  return end
}

/**
 * The timeline of a merged list, as `GET /api/files/timeline` describes one:
 * spans of upload dates for an order by date, in the calendar of this
 * browser, and one span for every other order.
 */
export function timelineOf(
  entries: readonly OrderedEntry[],
  sort: FileSort,
  groupBy: Grouping,
  snapshot: string,
  timezone: string
): FileTimeline {
  if (sort.field !== 'uploadedAt')
    return {
      total: entries.length,
      snapshot,
      groupBy: 'none',
      timezone,
      buckets: entries.length
        ? [
            {
              key: 'all',
              from: null,
              to: null,
              count: entries.length,
              offset: 0,
            },
          ]
        : [],
    }
  const span = groupBy === 'none' ? 'month' : groupBy
  const buckets: FileTimelineBucket[] = []
  entries.forEach((entry, index) => {
    const start = spanStart(new Date(String(entry.key)), span)
    const key = start.toISOString()
    const last = buckets[buckets.length - 1]
    if (last?.key === key) last.count++
    else
      buckets.push({
        key,
        from: key,
        to: spanEnd(start, span).toISOString(),
        count: 1,
        offset: index,
      })
  })
  return { total: entries.length, snapshot, groupBy, timezone, buckets }
}
