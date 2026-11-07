import { describe, expect, it } from 'vitest'

import { fileCardFilenameParts } from '@/components/dashboard/file-card/layout'

describe('file card filename boundaries', () => {
  it('retains the distinguishing terminal timestamp beside the extension', () => {
    const name = 'Screenshot 2026-11-06 at 18.16.17.png'
    const parts = fileCardFilenameParts(name)
    expect(parts.tail).toContain('18.16.17')
    expect(parts.extension).toBe('.png')
    expect(parts.start + parts.tail + parts.extension).toBe(name)
  })

  it('never splits a joined emoji or combining-mark grapheme', () => {
    for (const cluster of ['👩🏽‍💻', 'e\u0301', '🇫🇮']) {
      const name = 'Long demonstration filename ' + cluster.repeat(13) + '.txt'
      const parts = fileCardFilenameParts(name)
      expect(parts.tail).toBe(cluster.repeat(12))
      expect(parts.start.endsWith(cluster)).toBe(true)
      expect(parts.start + parts.tail + parts.extension).toBe(name)
    }
  })

  it('keeps filename whitespace inside fragments so visible labels stay complete', () => {
    for (const name of [
      'Screenshot 2026-11-06 at 18.16.17.png',
      'weekly release notes final copy.txt',
      'report .pdf',
      'a '.repeat(20) + 'z.txt',
    ]) {
      const parts = fileCardFilenameParts(name)
      expect(parts.start + parts.tail + parts.extension).toBe(name)
      // This models visible-label normalization at the two fragment edges.
      expect(parts.start.trim() + (parts.tail + parts.extension).trim()).toBe(
        name
      )
    }
  })

  it('keeps short and extensionless names intact', () => {
    expect(fileCardFilenameParts('notes.md')).toEqual({
      start: 'notes',
      tail: '',
      extension: '.md',
    })
    expect(fileCardFilenameParts('README')).toEqual({
      start: 'README',
      tail: '',
      extension: '',
    })
  })
})
