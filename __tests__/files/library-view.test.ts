import { describe, expect, it } from 'vitest'

import { fileVisibilityText } from '@/components/dashboard/file-card/layout'

import type { FileTimeline } from '@/lib/library/contract'
import {
  TIMELINE_WINDOW_ROWS,
  timelineLayout,
  timelineWindowStart,
} from '@/lib/library/timeline-layout'
import {
  libraryColumns,
  libraryViewForAccount,
  libraryViewStorageKey,
  parseLibraryView,
} from '@/lib/library/view'

describe('device-local library view', () => {
  it('retains actual Public/Private visibility when password protection is present', () => {
    expect(fileVisibilityText('PUBLIC', false)).toBe('Public')
    expect(fileVisibilityText('PRIVATE', false)).toBe('Private')
    expect(fileVisibilityText('PUBLIC', true)).toBe(
      'Public · password protected'
    )
    expect(fileVisibilityText('PRIVATE', true)).toBe(
      'Private · password protected'
    )
  })
  it('defaults invalid or absent storage to Gallery without accepting another shape', () => {
    expect(parseLibraryView('list')).toBe('list')
    for (const value of [
      null,
      undefined,
      '',
      'gallery',
      'List',
      'dense',
      true,
      ['list'],
      { view: 'list' },
    ])
      expect(parseLibraryView(value)).toBe('gallery')
  })
  it('isolates accounts and never exposes an old account snapshot while the next loads', () => {
    expect(libraryViewStorageKey(null)).toBeNull()
    expect(libraryViewStorageKey('alice')).not.toBe(
      libraryViewStorageKey('bob')
    )
    expect(libraryViewStorageKey('a:b')).not.toBe(
      libraryViewStorageKey('a%3Ab')
    )
    const alice = { accountId: 'alice', view: 'list' as const }
    expect(libraryViewForAccount('alice', alice)).toBe('list')
    expect(libraryViewForAccount('bob', alice)).toBe('gallery')
    expect(libraryViewForAccount(null, alice)).toBe('gallery')
    expect(libraryViewForAccount('bob', null)).toBe('gallery')
  })
  it('retains Gallery breakpoints while every List viewport has one file per row', () => {
    for (const [width, columns] of [
      [320, 1],
      [639, 1],
      [640, 2],
      [820, 2],
      [1023, 2],
      [1024, 3],
      [1279, 3],
      [1280, 4],
      [1440, 4],
    ]) {
      expect(libraryColumns('gallery', width)).toBe(columns)
      expect(libraryColumns('list', width)).toBe(1)
    }
  })
})

describe('presentation-independent timeline file ranks', () => {
  const timeline: FileTimeline = {
    total: 12001,
    snapshot: '2026-11-08T00:00:00Z',
    groupBy: 'month',
    timezone: 'UTC',
    buckets: [
      {
        key: 'nov',
        from: '2026-11-01T00:00:00Z',
        to: '2026-12-01T00:00:00Z',
        offset: 0,
        count: 5,
      },
      {
        key: 'oct',
        from: '2026-10-01T00:00:00Z',
        to: '2026-11-01T00:00:00Z',
        offset: 5,
        count: 11996,
      },
    ],
  }
  it('maps deep saved ranks and partial month rows in either presentation without loss/repetition', () => {
    for (const grouped of [false, true])
      for (const view of ['gallery', 'list'] as const)
        for (const width of [390, 820, 1440]) {
          const columns = libraryColumns(view, width),
            layout = timelineLayout(timeline, columns, grouped)
          const ranks = Array.from(
            { length: layout.rowCount },
            (_, i) => layout.row(i).indices
          ).flat()
          expect(ranks).toEqual(Array.from({ length: 12001 }, (_, i) => i))
          for (const rank of [0, 4, 5, 7979, 8000, 12000]) {
            const row = layout.rowAt(rank)
            expect(layout.row(row).indices).toContain(rank)
            if (view === 'list') expect(layout.row(row).indices).toEqual([rank])
            const start = timelineWindowStart(row, layout.rowCount)
            expect(row - start).toBeGreaterThanOrEqual(0)
            expect(row - start).toBeLessThan(TIMELINE_WINDOW_ROWS)
          }
        }
  })
})
