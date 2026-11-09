import { describe, expect, it, vi } from 'vitest'

import { fileSort } from '@/lib/files/gallery-navigation'
import { fileListFilters } from '@/lib/files/list-filters'
import {
  BATCH_LIMIT,
  DEFAULT_PAGE_SIZE,
  type FileTimelineBucket,
  MAX_PAGE_SIZE,
  SORT_OPTIONS,
  UNFILED,
  UNTAGGED,
  VISIBILITY_FILTERS,
  folderDestination,
  isDateOrder,
  libraryHref,
  libraryQuery,
  librarySort,
  listQuery,
  readLibraryFilters,
  timelineWindow,
  uploadHref,
} from '@/lib/library/contract'

vi.mock('@/lib/database/prisma', () => ({ prisma: {} }))

const view = (query = '') => readLibraryFilters(new URLSearchParams(query))

describe('library addresses', () => {
  it('reads an empty address as the whole library, newest first', () => {
    expect(view()).toEqual({
      folder: null,
      tag: null,
      search: '',
      types: [],
      visibility: [],
      index: [],
      minSize: null,
      maxSize: null,
      dateFrom: null,
      dateTo: null,
      sortBy: 'newest',
      groupBy: 'none',
      page: 1,
      limit: DEFAULT_PAGE_SIZE,
    })
    expect(libraryQuery(view())).toBe('')
    expect(libraryHref()).toBe('/dashboard')
  })

  it('ranks a search by best match unless the address names another order', () => {
    expect(view('search=invoice').sortBy).toBe('relevance')
    expect(libraryQuery(view('search=invoice'))).toBe('search=invoice')
    expect(view('search=invoice&sortBy=newest').sortBy).toBe('newest')
    expect(libraryQuery(view('search=invoice&sortBy=newest'))).toBe(
      'search=invoice&sortBy=newest'
    )
    // Without a search there's nothing to rank.
    expect(view('sortBy=relevance').sortBy).toBe('newest')
    expect(view('search=x&sortBy=relevance&groupBy=month').groupBy).toBe('none')
  })

  it('reads size and search index filters, ignoring values it does not offer', () => {
    const filters = view('minSize=1024&maxSize=lots&index=failed,waiting,nope')
    expect(filters).toMatchObject({
      minSize: 1024,
      maxSize: null,
      index: ['failed', 'waiting'],
    })
    expect(libraryQuery(filters)).toBe('index=failed%2Cwaiting&minSize=1024')
    expect(Object.fromEntries(listQuery(filters))).toMatchObject({
      index: 'failed,waiting',
      minSize: '1024',
    })
    expect(view('minSize=-1').minSize).toBeNull()
  })

  it('ignores values the library does not offer and groups only upload-date orders', () => {
    expect(view('sortBy=name').sortBy).toBe('newest')
    expect(view('sortBy=constructor').sortBy).toBe('newest')
    expect(view('sortBy=largest&groupBy=month').groupBy).toBe('none')
    expect(view('sortBy=oldest&groupBy=week').groupBy).toBe('week')
    expect(view('groupBy=decade').groupBy).toBe('none')
    expect(
      view('visibility=PUBLIC,hasPassword,private,private').visibility
    ).toEqual(['hasPassword', 'private'])
    expect(view(`limit=${MAX_PAGE_SIZE + 1}&page=0`)).toMatchObject({
      limit: MAX_PAGE_SIZE,
      page: 1,
    })
  })

  it('writes the same canonical query it reads, leaving out defaults', () => {
    const query =
      'folder=cmfolder&tag=cmtag&groupBy=month&search=a+b&types=image%2Fpng&visibility=private%2ChasPassword&sortBy=oldest&page=3&limit=50'
    expect(libraryQuery(view(query))).toBe(query)
    expect(libraryHref({ folder: UNFILED })).toBe('/dashboard?folder=unfiled')
    expect(libraryHref({ folder: 'cmfolder', sortBy: 'largest' })).toBe(
      '/dashboard?folder=cmfolder&sortBy=largest'
    )
  })

  it('opens the upload page in a folder, never in Unfiled', () => {
    expect(uploadHref()).toBe('/dashboard/upload')
    expect(uploadHref('cmfolder')).toBe('/dashboard/upload?folder=cmfolder')
    expect(folderDestination(UNFILED)).toBeNull()
    expect(folderDestination(null)).toBeNull()
    expect(folderDestination('cmfolder')).toBe('cmfolder')
  })

  it('asks the list API for a view without its legacy page position', () => {
    const params = listQuery(
      view('folder=f&tag=t&page=4&limit=5&sortBy=oldest')
    )
    expect(Object.fromEntries(params)).toEqual({
      search: '',
      sortBy: 'oldest',
      folder: 'f',
      tag: 't',
    })
  })
})

describe('timeline windows', () => {
  const bucket: FileTimelineBucket = {
    key: '2026-10-01T00:00:00.000Z',
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-11-01T00:00:00.000Z',
    count: 100,
    offset: 20,
  }
  const timeline = { snapshot: '2026-10-20T00:00:00.000Z' }

  it('reads the dated bucket with an inclusive end and the snapshot', () => {
    const { query, length } = timelineWindow(view(), timeline, bucket, 3, 48)
    expect(Object.fromEntries(query)).toMatchObject({
      page: '3',
      limit: '48',
      snapshot: timeline.snapshot,
      dateFrom: bucket.from,
      dateTo: '2026-10-31T23:59:59.999Z',
    })
    expect(length).toBe(4)
  })

  it('never widens a narrower date range, and keeps it for undated buckets', () => {
    const narrow = view(
      'dateFrom=2026-10-05T00:00:00.000Z&dateTo=2026-10-06T00:00:00.000Z'
    )
    expect(
      Object.fromEntries(timelineWindow(narrow, timeline, bucket, 1, 48).query)
    ).toMatchObject({
      dateFrom: '2026-10-05T00:00:00.000Z',
      dateTo: '2026-10-06T00:00:00.000Z',
    })
    const undated = { ...bucket, key: 'all', from: null, to: null }
    expect(
      Object.fromEntries(timelineWindow(narrow, timeline, undated, 1, 48).query)
    ).toMatchObject({
      dateFrom: '2026-10-05T00:00:00.000Z',
      dateTo: '2026-10-06T00:00:00.000Z',
    })
  })
})

describe('the list API reads the same vocabulary', () => {
  it('orders by what each library sort names, plus name, and newest otherwise', () => {
    expect(
      SORT_OPTIONS.map(({ value }) => [value, fileSort(value)])
    ).toMatchObject([
      ['newest', { field: 'uploadedAt', direction: 'desc' }],
      ['oldest', { field: 'uploadedAt', direction: 'asc' }],
      ['largest', { field: 'size', direction: 'desc' }],
      ['smallest', { field: 'size', direction: 'asc' }],
      ['most-viewed', { field: 'views', direction: 'desc' }],
      ['least-viewed', { field: 'views', direction: 'asc' }],
      ['most-downloaded', { field: 'downloads', direction: 'desc' }],
      ['least-downloaded', { field: 'downloads', direction: 'asc' }],
      // Lists without a search have nothing to rank; searches order in SQL.
      ['relevance', { field: 'uploadedAt', direction: 'desc' }],
    ])
    expect(fileSort('name')).toEqual({ field: 'name', direction: 'asc' })
    expect(fileSort('constructor')).toMatchObject({
      field: 'uploadedAt',
      direction: 'desc',
    })
    expect(SORT_OPTIONS.filter((sort) => isDateOrder(sort))).toHaveLength(2)
    expect(isDateOrder(fileSort('name'))).toBe(false)
    expect(librarySort('largest').label).toBe('Largest first')
  })

  it('accepts every visibility filter the library offers, visibility names in any case', () => {
    const where = (visibility: string) =>
      fileListFilters('owner', new URLSearchParams({ visibility })).where
    for (const { value } of VISIBILITY_FILTERS)
      expect(() => where(value)).not.toThrow()
    expect(where('PUBLIC,Private,hasPassword')).toEqual({
      userId: 'owner',
      AND: [
        {
          OR: [
            { visibility: 'PUBLIC' },
            { visibility: 'PRIVATE' },
            { password: { not: null } },
          ],
        },
      ],
    })
    for (const value of ['HASPASSWORD', 'unlisted', ''])
      expect(() => where(value)).toThrow(
        'visibility must be public, private, or hasPassword'
      )
  })

  it('reads Unfiled, Untagged and the selection limit as the library writes them', () => {
    const where = (params: Record<string, string>) =>
      fileListFilters('owner', new URLSearchParams(params)).where.AND
    expect(where({ folder: UNFILED })).toEqual([{ folderId: null }])
    expect(where({ tag: UNTAGGED })).toEqual([
      { tags: { none: { excluded: false } } },
    ])
    const ids = Array.from({ length: BATCH_LIMIT + 1 }, (_, i) => `id${i}`)
    expect(() =>
      where({ ids: ids.slice(0, BATCH_LIMIT).join(',') })
    ).not.toThrow()
    expect(() => where({ ids: ids.join(',') })).toThrow(
      'ids must contain 1 to 100 distinct file IDs'
    )
  })
})
