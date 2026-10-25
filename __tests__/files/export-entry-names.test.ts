import { describe, expect, it } from 'vitest'

import { exportEntryNamer } from '@/lib/files/export-entry-names'

const day = (date: string) => new Date(`${date}T12:00:00Z`)

function nameAll(names: string[], date = '2026-10-01') {
  const next = exportEntryNamer()
  return names.map((name) => next({ name, uploadedAt: day(date) }))
}

describe('data export entry names', () => {
  it('numbers repeated names per day, ignoring case', () => {
    const next = exportEntryNamer()
    expect(
      [
        ['report.pdf', '2026-10-01'],
        ['report.pdf', '2026-10-01'],
        ['Report.PDF', '2026-10-01'],
        ['report.pdf', '2026-10-02'],
        ['notes', '2026-10-01'],
        ['notes', '2026-10-01'],
      ].map(([name, date]) => next({ name, uploadedAt: day(date) }))
    ).toEqual([
      'files/2026-10-01/report.pdf',
      'files/2026-10-01/report (2).pdf',
      'files/2026-10-01/Report (3).PDF',
      'files/2026-10-02/report.pdf',
      'files/2026-10-01/notes',
      'files/2026-10-01/notes (2)',
    ])
  })

  it('skips numbers that a literal file name already uses', () => {
    expect(
      nameAll(['report.pdf', 'report (2).pdf', 'report.pdf', 'report.pdf'])
    ).toEqual([
      'files/2026-10-01/report.pdf',
      'files/2026-10-01/report (2).pdf',
      'files/2026-10-01/report (3).pdf',
      'files/2026-10-01/report (4).pdf',
    ])
    expect(nameAll(['report.pdf', 'report.pdf', 'report (2).pdf'])).toEqual([
      'files/2026-10-01/report.pdf',
      'files/2026-10-01/report (2).pdf',
      'files/2026-10-01/report (2) (2).pdf',
    ])
  })

  it('names thousands of repeated files with about one lookup each', () => {
    const count = 4_000
    const has = Set.prototype.has
    let lookups = 0
    // Counts the namer's lookups; nothing else runs during this loop.
    Set.prototype.has = function (this: Set<unknown>, value: unknown) {
      lookups++
      return has.call(this, value)
    }
    let names: string[]
    try {
      names = nameAll(Array.from({ length: count }, () => 'report.pdf'))
    } finally {
      Set.prototype.has = has
    }
    expect(names[0]).toBe('files/2026-10-01/report.pdf')
    expect(names[count - 1]).toBe(`files/2026-10-01/report (${count}).pdf`)
    expect(new Set(names).size).toBe(count)
    // Restarting the search at 1 for every file took count * (count + 1) / 2.
    expect(lookups).toBeLessThanOrEqual(2 * count)
  })
})
