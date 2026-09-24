import { describe, expect, it } from 'vitest'

import {
  filtersFromLibrary,
  savedViewFiltersSchema,
  savedViewInputSchema,
  savedViewMatches,
  savedViewUpdateSchema,
} from '@/lib/saved-views/schema'

const defaults = savedViewFiltersSchema.parse({})

describe('saved view contracts', () => {
  it('captures every library filter but never pagination or page size', () => {
    const library = {
      ...defaults,
      page: 8,
      limit: 48,
      folder: 'unfiled',
      tag: 'untagged',
      groupBy: 'month' as const,
      search: 'invoice',
      types: ['image/png', 'image/jpeg', 'image/png'],
      visibility: ['private', 'public'],
      dateFrom: '2026-09-01T01:00:00+01:00',
    }
    expect(filtersFromLibrary(library)).toEqual({
      ...defaults,
      folder: 'unfiled',
      tag: 'untagged',
      groupBy: 'month',
      search: 'invoice',
      types: ['image/jpeg', 'image/png'],
      visibility: ['private', 'public'],
      dateFrom: '2026-09-01T00:00:00.000Z',
    })
    expect(
      savedViewMatches(filtersFromLibrary(library), {
        ...library,
        page: 1,
        limit: 12,
        types: ['image/jpeg', 'image/png'],
        visibility: ['public', 'private'],
      })
    ).toBe(true)
    expect(
      savedViewMatches(filtersFromLibrary(library), {
        ...library,
        folder: null,
      })
    ).toBe(false)
  })

  it('trims names and defaults to pinned while rejecting empty or oversized names', () => {
    expect(
      savedViewInputSchema.parse({
        name: '  Screenshot journal  ',
        filters: {},
      })
    ).toEqual({ name: 'Screenshot journal', pinned: true, filters: defaults })
    for (const name of ['', '  ', 'a'.repeat(41)])
      expect(
        savedViewInputSchema.safeParse({ name, filters: {} }).success
      ).toBe(false)
  })

  it.each([
    { page: 2 },
    { limit: 48 },
    { search: 'x'.repeat(501) },
    { folder: 'x'.repeat(101) },
    { visibility: ['hidden'] },
    { types: ['not a mime type'] },
    { types: Array.from({ length: 51 }, (_, i) => `application/type${i}`) },
    { dateFrom: '2026-02-30T00:00:00Z' },
    { dateFrom: '2026-09-01T00:00:00+24:00' },
    { dateFrom: '2026-09-01T00:00:00+99:99' },
    { dateTo: '2026-09-01T00:00:00+12:99' },
    { dateFrom: '2026-09-02T00:00:00Z', dateTo: '2026-09-01T00:00:00Z' },
    { groupBy: 'month', sortBy: 'largest' },
  ])('rejects invalid or unbounded filters %j', (filters) => {
    expect(savedViewFiltersSchema.safeParse(filters).success).toBe(false)
  })

  it('requires a positive revision and an explicit edit, rejecting unrecognized fields', () => {
    for (const input of [
      { name: 'New name' },
      { revision: 0, pinned: false },
      { revision: 1 },
      { revision: 1, userId: 'other', name: 'New name' },
    ])
      expect(savedViewUpdateSchema.safeParse(input).success).toBe(false)
    expect(savedViewUpdateSchema.parse({ revision: 1, pinned: false })).toEqual(
      { revision: 1, pinned: false }
    )
  })
})
