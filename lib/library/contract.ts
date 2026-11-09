/**
 * What the file library's addresses and list requests mean, shared by the list
 * API and the dashboard: the choices its controls offer, its page sizes and
 * limits, and the timeline the API returns. The dashboard bundles this module,
 * so it imports only types.
 */
import type { FileVisibility } from '@prisma/client'

/** The `folder` value for files outside every folder. */
export const UNFILED = 'unfiled'
/** The `tag` value for files without an active tag. */
export const UNTAGGED = 'untagged'

export const DEFAULT_PAGE_SIZE = 24
export const MAX_PAGE_SIZE = 100
/** The most files one selection, `ids` filter or bulk change takes. */
export const BATCH_LIMIT = 100

export type SortField = 'uploadedAt' | 'size' | 'views' | 'downloads' | 'name'
export interface FileSort {
  /** `relevance` orders search results by how well they match. */
  field: SortField | 'relevance'
  direction: 'asc' | 'desc'
}

/**
 * The library's orders as its menu lists them. The first is the default
 * without a search; the last, Best match, is the default with one and only
 * applies to searches.
 */
export const SORT_OPTIONS = [
  {
    value: 'newest',
    label: 'Newest first',
    field: 'uploadedAt',
    direction: 'desc',
  },
  {
    value: 'oldest',
    label: 'Oldest first',
    field: 'uploadedAt',
    direction: 'asc',
  },
  {
    value: 'largest',
    label: 'Largest first',
    field: 'size',
    direction: 'desc',
  },
  {
    value: 'smallest',
    label: 'Smallest first',
    field: 'size',
    direction: 'asc',
  },
  {
    value: 'most-viewed',
    label: 'Most viewed',
    field: 'views',
    direction: 'desc',
  },
  {
    value: 'least-viewed',
    label: 'Least viewed',
    field: 'views',
    direction: 'asc',
  },
  {
    value: 'most-downloaded',
    label: 'Most downloaded',
    field: 'downloads',
    direction: 'desc',
  },
  {
    value: 'least-downloaded',
    label: 'Least downloaded',
    field: 'downloads',
    direction: 'asc',
  },
  {
    value: 'relevance',
    label: 'Best match',
    field: 'relevance',
    direction: 'desc',
  },
] as const satisfies readonly (FileSort & { value: string; label: string })[]
export type SortOption = (typeof SORT_OPTIONS)[number]['value']
/** Addresses leave this order out. */
export const DEFAULT_SORT = SORT_OPTIONS[0].value
export const RELEVANCE_SORT = 'relevance' satisfies SortOption

/** The order a library address without `sortBy` uses. */
export function defaultSort(search: string): SortOption {
  return search.trim() ? RELEVANCE_SORT : DEFAULT_SORT
}

/** The library order a `sortBy` value names; anything else is the default. */
export function librarySort(sortBy: string | null) {
  return (
    SORT_OPTIONS.find((option) => option.value === sortBy) ?? SORT_OPTIONS[0]
  )
}

/** Upload-date orders are the ones that can be grouped by date and scrubbed. */
export function isDateOrder(sort: FileSort): boolean {
  return sort.field === 'uploadedAt'
}

export const GROUP_OPTIONS = [
  { value: 'none', label: 'No grouping' },
  { value: 'week', label: 'By week' },
  { value: 'month', label: 'By month' },
  { value: 'year', label: 'By year' },
] as const
export type FileGrouping = (typeof GROUP_OPTIONS)[number]['value']

export function isGrouping(value: string | null): value is FileGrouping {
  return GROUP_OPTIONS.some((option) => option.value === value)
}

/** Each filter matches a stored visibility, or a password. */
export const VISIBILITY_FILTERS = [
  { value: 'public', label: 'Public', visibility: 'PUBLIC' },
  { value: 'private', label: 'Private', visibility: 'PRIVATE' },
  { value: 'hasPassword', label: 'Password protected' },
] as const satisfies readonly {
  value: string
  label: string
  visibility?: FileVisibility
}[]
export type VisibilityFilter = (typeof VISIBILITY_FILTERS)[number]['value']

/** What the search index knows about a file, as filters and the API name it. */
export const INDEX_FILTERS = [
  { value: 'waiting', label: 'Waiting to be read' },
  { value: 'indexed', label: 'Text found' },
  { value: 'empty', label: 'No text found' },
  { value: 'failed', label: 'Couldn’t be read' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'unsupported', label: 'Contents not searchable' },
] as const
export type IndexFilter = (typeof INDEX_FILTERS)[number]['value']

/** Bytes. The largest size filter a request may name. */
export const MAX_SIZE_FILTER = 2 ** 50

/** The view a library address shows. */
export interface LibraryFilters {
  folder: string | null
  tag: string | null
  search: string
  types: string[]
  visibility: VisibilityFilter[]
  /** Search index states; files in any of them match. */
  index: IndexFilter[]
  /** Bytes, inclusive. */
  minSize: number | null
  maxSize: number | null
  dateFrom: string | null
  dateTo: string | null
  sortBy: SortOption
  groupBy: FileGrouping
  /**
   * Old page links. They only choose where the list opens: at file
   * `(page - 1) * limit`.
   */
  page: number
  limit: number
}

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function size(value: string | null) {
  if (value === null || value === '') return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) &&
    parsed >= 0 &&
    parsed <= MAX_SIZE_FILTER
    ? parsed
    : null
}

function validDate(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** The view an address's query names, ignoring values the library doesn't offer. */
export function readLibraryFilters(params: URLSearchParams): LibraryFilters {
  const search = params.get('search') || ''
  let sort = librarySort(params.get('sortBy') ?? defaultSort(search))
  // Best match ranks a search; without one there's nothing to rank by.
  if (sort.value === RELEVANCE_SORT && !search.trim()) sort = SORT_OPTIONS[0]
  const groupBy = params.get('groupBy')
  return {
    folder: params.get('folder') || null,
    tag: params.get('tag') || null,
    groupBy: isGrouping(groupBy) && isDateOrder(sort) ? groupBy : 'none',
    search,
    types: [...new Set(params.get('types')?.split(',').filter(Boolean) || [])],
    dateFrom: validDate(params.get('dateFrom')),
    dateTo: validDate(params.get('dateTo')),
    visibility: [
      ...new Set(
        params
          .get('visibility')
          ?.split(',')
          .filter((value): value is VisibilityFilter =>
            VISIBILITY_FILTERS.some((filter) => filter.value === value)
          ) || []
      ),
    ],
    index: [
      ...new Set(
        params
          .get('index')
          ?.split(',')
          .filter((value): value is IndexFilter =>
            INDEX_FILTERS.some((filter) => filter.value === value)
          ) || []
      ),
    ],
    minSize: size(params.get('minSize')),
    maxSize: size(params.get('maxSize')),
    sortBy: sort.value,
    page: positiveInteger(params.get('page'), 1),
    limit: Math.min(
      positiveInteger(params.get('limit'), DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE
    ),
  }
}

/** The address query for a view, leaving out every default. */
export function libraryQuery(filters: LibraryFilters): string {
  const params = new URLSearchParams()
  if (filters.folder) params.set('folder', filters.folder)
  if (filters.tag) params.set('tag', filters.tag)
  if (filters.groupBy !== 'none') params.set('groupBy', filters.groupBy)
  if (filters.search) params.set('search', filters.search)
  if (filters.types.length) params.set('types', filters.types.join(','))
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) params.set('dateTo', filters.dateTo)
  if (filters.visibility.length)
    params.set('visibility', filters.visibility.join(','))
  if (filters.index.length) params.set('index', filters.index.join(','))
  if (filters.minSize !== null) params.set('minSize', String(filters.minSize))
  if (filters.maxSize !== null) params.set('maxSize', String(filters.maxSize))
  if (filters.sortBy !== defaultSort(filters.search))
    params.set('sortBy', filters.sortBy)
  if (filters.page !== 1) params.set('page', filters.page.toString())
  if (filters.limit !== DEFAULT_PAGE_SIZE)
    params.set('limit', filters.limit.toString())
  return params.toString()
}

/** The library showing a view; anything left out takes its default. */
export function libraryHref(view: Partial<LibraryFilters> = {}): string {
  const query = libraryQuery({
    ...readLibraryFilters(new URLSearchParams()),
    ...view,
  })
  return query ? `/dashboard?${query}` : '/dashboard'
}

export function uploadHref(folder: string | null = null): string {
  return folder
    ? `/dashboard/upload?${new URLSearchParams({ folder })}`
    : '/dashboard/upload'
}

/** The folder new files from a library or upload address go into; null is Unfiled. */
export function folderDestination(folder: string | null): string | null {
  return folder && folder !== UNFILED ? folder : null
}

/** The list API parameters that choose a view's files and their order. */
export function listQuery(filters: LibraryFilters): URLSearchParams {
  return new URLSearchParams({
    search: filters.search,
    sortBy: filters.sortBy,
    ...(filters.folder && { folder: filters.folder }),
    ...(filters.tag && { tag: filters.tag }),
    ...(filters.types.length > 0 && { types: filters.types.join(',') }),
    ...(filters.dateFrom && { dateFrom: filters.dateFrom }),
    ...(filters.dateTo && { dateTo: filters.dateTo }),
    ...(filters.visibility.length > 0 && {
      visibility: filters.visibility.join(','),
    }),
    ...(filters.index.length > 0 && { index: filters.index.join(',') }),
    ...(filters.minSize !== null && { minSize: String(filters.minSize) }),
    ...(filters.maxSize !== null && { maxSize: String(filters.maxSize) }),
  })
}

/** A span of upload dates in `GET /api/files/timeline`. */
export interface FileTimelineBucket {
  /** `from`, or `all` for the one bucket of an order that isn't by date. */
  key: string
  /** Inclusive. Null in the bucket of an order that isn't by date. */
  from: string | null
  /** Exclusive. */
  to: string | null
  count: number
  /** How many matching files come before this bucket in the order. */
  offset: number
}

export interface FileTimeline {
  total: number
  /** Files uploaded after this instant are left out of every window. */
  snapshot: string
  groupBy: FileGrouping
  timezone: string
  buckets: FileTimelineBucket[]
  /**
   * With a search: `every` when the files have every word, `some` when none
   * did and the list holds files with some of them. Absent without a search.
   */
  searchMatch?: 'every' | 'some'
}

/**
 * The `GET /api/files` request for one page of a bucket, and how many files a
 * full answer holds. Pages count from 1 inside the bucket. The list's `dateTo`
 * is inclusive, so the bucket's exclusive end becomes the millisecond before.
 */
export function timelineWindow(
  filters: LibraryFilters,
  timeline: Pick<FileTimeline, 'snapshot' | 'searchMatch'>,
  bucket: FileTimelineBucket,
  page: number,
  pageSize: number
) {
  const query = listQuery(filters)
  query.set('page', String(page))
  query.set('limit', String(pageSize))
  query.set('snapshot', timeline.snapshot)
  if (timeline.searchMatch) query.set('searchMatch', timeline.searchMatch)
  if (bucket.from && bucket.to) {
    query.set(
      'dateFrom',
      new Date(
        Math.max(
          Date.parse(bucket.from),
          filters.dateFrom ? Date.parse(filters.dateFrom) : -Infinity
        )
      ).toISOString()
    )
    query.set(
      'dateTo',
      new Date(
        Math.min(
          Date.parse(bucket.to) - 1,
          filters.dateTo ? Date.parse(filters.dateTo) : Infinity
        )
      ).toISOString()
    )
  }
  return {
    query,
    length: Math.min(pageSize, bucket.count - (page - 1) * pageSize),
  }
}
