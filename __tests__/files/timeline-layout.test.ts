import { describe, expect, it } from 'vitest'

import {
  type FileTimeline,
  TIMELINE_WINDOW_ROWS,
  bucketAt,
  bucketLabel,
  timelineLayout,
  timelinePage,
  timelineWindowStart,
} from '@/lib/files/timeline-layout'

const timeline: FileTimeline = {
  total: 109,
  snapshot: '2026-10-06T10:00:00.000Z',
  groupBy: 'none',
  timezone: 'UTC',
  buckets: [
    {
      key: 'oct',
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-11-01T00:00:00.000Z',
      count: 5,
      offset: 0,
    },
    {
      key: 'sep',
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z',
      count: 103,
      offset: 5,
    },
    {
      key: 'aug',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
      count: 1,
      offset: 108,
    },
  ],
}

describe('sparse timeline layout', () => {
  it('fills ungrouped rows across month and page boundaries without missing or repeating files', () => {
    for (const columns of [1, 2, 3, 4]) {
      const layout = timelineLayout(timeline, columns, false)
      const indices = Array.from(
        { length: layout.rowCount },
        (_, row) => layout.row(row).indices
      ).flat()
      expect(indices).toEqual(
        Array.from({ length: timeline.total }, (_, index) => index)
      )
      indices.forEach((index) =>
        expect(layout.row(layout.rowAt(index)).indices).toContain(index)
      )
    }
    const row = timelineLayout(timeline, 4, false).row(1)
    expect(
      row.indices.map((index) => bucketAt(timeline.buckets, index).key)
    ).toEqual(['oct', 'sep', 'sep', 'sep'])
    expect(timelinePage(timeline.buckets[1], 52).page).toBe(1)
    expect(timelinePage(timeline.buckets[1], 53).page).toBe(2)
  })

  it('keeps grouped headers separate, preserves partial rows, and restores legacy positions', () => {
    const layout = timelineLayout(timeline, 4, true)
    const rows = Array.from({ length: layout.rowCount }, (_, row) =>
      layout.row(row)
    )
    expect(
      rows.filter((row) => row.heading).map((row) => row.heading?.key)
    ).toEqual(['oct', 'sep', 'aug'])
    expect(rows.flatMap((row) => row.indices)).toEqual(
      Array.from({ length: 109 }, (_, index) => index)
    )
    expect(layout.row(layout.rowAt(108)).indices).toEqual([108])
    expect(layout.row(2).indices).toEqual([4])
  })

  it('supports million-file positions without constructing a million-file array', () => {
    const huge = {
      ...timeline,
      total: 1_000_000,
      buckets: [{ ...timeline.buckets[0], count: 1_000_000 }],
    }
    const layout = timelineLayout(huge, 1, false)
    expect(layout.rowCount).toBe(1_000_000)
    expect(layout.row(layout.rowAt(999_999)).indices).toEqual([999_999])
    for (const target of [0, 8000, 500_000, 999_999]) {
      const start = timelineWindowStart(target, layout.rowCount)
      expect(target - start).toBeGreaterThanOrEqual(0)
      expect(target - start).toBeLessThan(TIMELINE_WINDOW_ROWS)
    }
  })

  it('formats dates in the account viewer’s local calendar, including UTC+14', () => {
    expect(
      bucketLabel(
        { ...timeline.buckets[0], from: '2026-09-30T10:00:00.000Z' },
        'month',
        'Pacific/Kiritimati'
      )
    ).toBe('October 2026')
    expect(
      bucketLabel({ ...timeline.buckets[0], from: null }, 'none', 'UTC')
    ).toBe('All files')
  })
})
