import type { FileFilterOptions, FileType } from '@/types/components/file'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { adjacentImagePage, fileQuery, groupFiles } from '@/lib/files/gallery'

const filters: FileFilterOptions = {
  groupBy: 'none',
  page: 1,
  limit: 24,
  search: 'trip',
  types: ['image/jpeg', 'application/pdf'],
  visibility: ['private'],
  dateFrom: '2025-01-01T00:00:00.000Z',
  dateTo: null,
  sortBy: 'oldest',
}

function file(
  id: string,
  uploadedAt = '2026-09-16T12:00:00',
  mimeType = 'image/jpeg'
): FileType {
  return {
    id,
    uploadedAt,
    mimeType,
    name: id,
    urlPath: `/${id}`,
    size: 100,
    visibility: 'PRIVATE',
    hasPassword: false,
    views: 0,
    downloads: 0,
  }
}

function pageResponse(page: number, data: FileType[], pageCount = 4) {
  return new Response(
    JSON.stringify({
      data,
      pagination: { page, pageCount, total: 96, limit: 24 },
    })
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('file grouping', () => {
  it('groups uploads by local month while preserving chronological navigation order', () => {
    const files = [
      file('sept-2'),
      file('sept-1', '2026-09-01T12:00:00', 'application/pdf'),
      file('aug', '2026-08-31T12:00:00'),
    ]
    const groups = groupFiles(files, 'month')
    expect(groups.map((group) => group.label)).toEqual([
      'September 2026',
      'August 2026',
    ])
    expect(groups.flatMap((group) => group.files)).toEqual(files)
  })

  it('uses Monday-based weeks that include the year across year boundaries', () => {
    const groups = groupFiles(
      [file('jan', '2026-01-01T12:00:00'), file('dec', '2025-12-29T12:00:00')],
      'week'
    )
    expect(groups).toEqual([
      {
        label: 'Week of Dec 29, 2025',
        files: [
          file('jan', '2026-01-01T12:00:00'),
          file('dec', '2025-12-29T12:00:00'),
        ],
      },
    ])
  })

  it('supports years and leaves an ungrouped gallery in its selected sort order', () => {
    const files = [
      file('2025', '2025-12-31T12:00:00'),
      file('2026', '2026-01-01T12:00:00'),
    ]
    expect(groupFiles(files, 'year').map((group) => group.label)).toEqual([
      '2025',
      '2026',
    ])
    expect(groupFiles(files, 'none')).toEqual([{ label: '', files }])
  })
})

describe('gallery page navigation', () => {
  it('preserves the whole filter when generating an adjacent page request', () => {
    expect(
      Object.fromEntries(fileQuery({ ...filters, groupBy: 'month' }, 3))
    ).toEqual({
      page: '3',
      limit: '24',
      search: 'trip',
      sortBy: 'oldest',
      types: 'image/jpeg,application/pdf',
      visibility: 'private',
      dateFrom: filters.dateFrom,
    })
  })

  it.each([1, -1] as const)(
    'skips document-only pages in direction %s without changing filters',
    async (direction) => {
      const start = direction === 1 ? 1 : 4
      const imagePage = start + direction * 2
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          pageResponse(start + direction, [
            file('pdf', undefined, 'application/pdf'),
          ])
        )
        .mockResolvedValueOnce(
          pageResponse(imagePage, [
            file('photo'),
            file('text', undefined, 'text/plain'),
          ])
        )
      vi.stubGlobal('fetch', fetchMock)
      const signal = new AbortController().signal
      const result = await adjacentImagePage({
        filters,
        page: start,
        pageCount: 4,
        direction,
        signal,
      })
      expect(result?.files.map((image) => image.id)).toEqual(['photo'])
      expect(result?.pagination.page).toBe(imagePage)
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        `/api/files?${fileQuery(filters, start + direction)}`,
        { signal }
      )
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        `/api/files?${fileQuery(filters, imagePage)}`,
        { signal }
      )
    }
  )

  it('returns the boundary instead of wrapping when no further images exist', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        pageResponse(4, [file('pdf', undefined, 'application/pdf')])
      )
    vi.stubGlobal('fetch', fetchMock)
    const result = await adjacentImagePage({
      filters,
      page: 3,
      pageCount: 4,
      direction: 1,
      signal: new AbortController().signal,
    })
    expect(result).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('propagates request errors so the viewer can keep the current image and retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }))
    )
    await expect(
      adjacentImagePage({
        filters,
        page: 1,
        pageCount: 4,
        direction: 1,
        signal: new AbortController().signal,
      })
    ).rejects.toThrow('Could not load the next image')
  })

  it('does not continue scanning after the viewer is closed', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn().mockImplementation(async () => {
      controller.abort()
      return pageResponse(2, [file('pdf', undefined, 'application/pdf')])
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      adjacentImagePage({
        filters,
        page: 1,
        pageCount: 4,
        direction: 1,
        signal: controller.signal,
      })
    ).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
