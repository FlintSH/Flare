import type { FileType } from '@/types/components/file'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type LibraryFilters, listQuery } from '@/lib/library/contract'
import { adjacentImagePage } from '@/lib/library/gallery'

const filters: LibraryFilters = {
  groupBy: 'none',
  page: 1,
  limit: 24,
  search: 'trip',
  tag: 'travel-tag',
  folder: 'week-one',
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

afterEach(() => vi.unstubAllGlobals())

describe('gallery page navigation', () => {
  it('preserves the whole filter, and no page position, when generating a list request', () => {
    expect(
      Object.fromEntries(
        listQuery({ ...filters, groupBy: 'month', page: 3, limit: 5 })
      )
    ).toEqual({
      search: 'trip',
      tag: 'travel-tag',
      folder: 'week-one',
      sortBy: 'oldest',
      types: 'image/jpeg,application/pdf',
      visibility: 'private',
      dateFrom: filters.dateFrom,
    })
  })

  it('loads neighbors in default-size windows whatever limit an old page link carried', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [], pagination: { offset: 0 } }))
      )
    vi.stubGlobal('fetch', fetchMock)
    await adjacentImagePage({
      filters: { ...filters, page: 4, limit: 5 },
      anchorId: 'current',
      direction: 1,
      signal: new AbortController().signal,
    })
    const url = new URL(fetchMock.mock.calls[0][0], 'http://localhost')
    expect(url.searchParams.get('limit')).toBe('24')
    expect(url.searchParams.has('page')).toBe(false)
  })

  it.each([1, -1] as const)(
    'requests image neighbors in direction %s using the active ID and all filters',
    async (direction) => {
      const pagination = {
        offset: 25,
        page: 2,
        pageCount: 4,
        total: 96,
        limit: 24,
      }
      const fetchMock = vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [file('photo')],
            pagination,
          })
        )
      )
      vi.stubGlobal('fetch', fetchMock)
      const signal = new AbortController().signal
      const result = await adjacentImagePage({
        filters,
        anchorId: 'current',
        direction,
        signal,
      })
      expect(result).toEqual({ files: [file('photo')], pagination })
      const [url, options] = fetchMock.mock.calls[0]
      expect(
        Object.fromEntries(new URL(url, 'http://localhost').searchParams)
      ).toEqual({
        limit: '24',
        search: 'trip',
        tag: 'travel-tag',
        folder: 'week-one',
        sortBy: 'oldest',
        types: 'image/jpeg,application/pdf',
        visibility: 'private',
        dateFrom: filters.dateFrom,
        galleryAnchor: 'current',
        galleryDirection: direction === 1 ? 'next' : 'previous',
      })
      expect(options).toEqual({ signal })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  )

  it('distinguishes an image removed from the results from an empty neighbor window', async () => {
    const pagination = { offset: 0, page: 1, pageCount: 1, total: 1, limit: 24 }
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 404 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: [], pagination }))
        )
    )
    const request = {
      filters,
      anchorId: 'current',
      direction: 1 as const,
      signal: new AbortController().signal,
    }
    expect(await adjacentImagePage(request)).toBeNull()
    expect(await adjacentImagePage(request)).toEqual({ files: [], pagination })
  })

  it('propagates request errors so the viewer can keep the current image and retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }))
    )
    await expect(
      adjacentImagePage({
        filters,
        anchorId: 'current',
        direction: 1,
        signal: new AbortController().signal,
      })
    ).rejects.toThrow('Could not load the next image')
  })

  it('ignores a response after the viewer is closed', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn().mockImplementation(async () => {
      controller.abort()
      return new Response(
        JSON.stringify({ data: [], pagination: { offset: 0 } })
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      adjacentImagePage({
        filters,
        anchorId: 'current',
        direction: 1,
        signal: controller.signal,
      })
    ).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
