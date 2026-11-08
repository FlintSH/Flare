import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fileCardFilenameParts } from '@/components/dashboard/file-card/layout'

describe('file card filename boundaries', () => {
  it('retains the distinguishing terminal timestamp beside the extension', () => {
    const name = 'Screenshot 2026-11-06 at 18.16.17.png'
    const parts = fileCardFilenameParts(name)
    expect(parts.tail).toContain('18.16.17')
    expect(parts.extension).toBe('.png')
    expect(parts.start + parts.separator + parts.tail + parts.extension).toBe(
      name
    )
  })

  it('never splits a joined emoji or combining-mark grapheme', () => {
    for (const cluster of ['👩🏽‍💻', 'e\u0301', '🇫🇮']) {
      const name = 'Long demonstration filename ' + cluster.repeat(13) + '.txt'
      const parts = fileCardFilenameParts(name)
      expect(parts.tail).toBe(cluster.repeat(12))
      expect(parts.start.endsWith(cluster)).toBe(true)
      expect(parts.start + parts.separator + parts.tail + parts.extension).toBe(
        name
      )
    }
  })

  it('keeps boundary whitespace explicit so visible labels stay complete', () => {
    for (const name of [
      'Screenshot 2026-11-06 at 18.16.17.png',
      'weekly release notes final copy.txt',
      'report .pdf',
      'a '.repeat(20) + 'z.txt',
    ]) {
      const parts = fileCardFilenameParts(name)
      expect(parts.start + parts.separator + parts.tail + parts.extension).toBe(
        name
      )
      // The dedicated separator survives normalization of the adjacent parts.
      expect(
        parts.start.trim() +
          parts.separator +
          (parts.tail + parts.extension).trim()
      ).toBe(name)
    }
  })

  it('keeps the observed phone filename boundary between words', () => {
    const name = 'Northern lights 00004.webp'
    const parts = fileCardFilenameParts(name)
    expect(parts).toEqual({
      start: 'Northern',
      separator: ' ',
      tail: 'lights 00004',
      extension: '.webp',
    })
    expect(parts.start + parts.separator + parts.tail + parts.extension).toBe(
      name
    )
  })

  it('preserves repeated boundary whitespace and spaces before an extension', () => {
    expect(fileCardFilenameParts('Northern  lights 00004.webp')).toEqual({
      start: 'Northern',
      separator: '  ',
      tail: 'lights 00004',
      extension: '.webp',
    })
    expect(fileCardFilenameParts('report .pdf')).toEqual({
      start: 'report',
      separator: ' ',
      tail: '',
      extension: '.pdf',
    })
  })

  it('keeps short and extensionless names intact', () => {
    expect(fileCardFilenameParts('notes.md')).toEqual({
      start: 'notes',
      separator: '',
      tail: '',
      extension: '.md',
    })
    expect(fileCardFilenameParts('README')).toEqual({
      start: 'README',
      separator: '',
      tail: '',
      extension: '',
    })
  })
})

describe('file card filenames without Intl.Segmenter', () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')

  beforeEach(() => {
    Object.defineProperty(Intl, 'Segmenter', {
      configurable: true,
      writable: true,
      value: undefined,
    })
    vi.resetModules()
  })

  afterEach(() => {
    if (originalDescriptor)
      Object.defineProperty(Intl, 'Segmenter', originalDescriptor)
    else Reflect.deleteProperty(Intl, 'Segmenter')
    vi.resetModules()
  })

  it('imports safely and preserves the compact ASCII filename algorithm', async () => {
    // A cached import would miss the original module-scope constructor crash.
    const { fileCardFilenameParts: partsFor, fileCardHeight } =
      await import('@/components/dashboard/file-card/layout')
    expect(typeof fileCardHeight).toBe('function')
    expect(partsFor('Northern lights 00004.webp')).toEqual({
      start: 'Northern',
      separator: ' ',
      tail: 'lights 00004',
      extension: '.webp',
    })
    expect(partsFor('report .pdf')).toEqual({
      start: 'report',
      separator: ' ',
      tail: '',
      extension: '.pdf',
    })
    for (const name of [
      'Screenshot 2026-11-06 at 18.16.17.png',
      'weekly release notes final copy.txt',
      'a  '.repeat(20) + 'z.txt',
      'README',
    ]) {
      const parts = partsFor(name)
      expect(parts.start + parts.separator + parts.tail + parts.extension).toBe(
        name
      )
    }
    expect(partsFor('Screenshot 2026-11-06 at 18.16.17.png').tail).toContain(
      '18.16.17'
    )
  })

  it('keeps complete Unicode clusters in an unsplit stem', async () => {
    const { fileCardFilenameParts: partsFor } =
      await import('@/components/dashboard/file-card/layout')
    for (const cluster of ['👩🏽‍💻', 'e\u0301', '🇫🇮']) {
      const stem = 'Long demonstration filename ' + cluster.repeat(13)
      const parts = partsFor(stem + '.txt')
      expect(parts).toEqual({
        start: stem,
        separator: '',
        tail: '',
        extension: '.txt',
      })
      expect(parts.start + parts.separator + parts.tail + parts.extension).toBe(
        stem + '.txt'
      )
    }
  })

  it('preserves internal Unicode whitespace and separates only trailing whitespace', async () => {
    const { fileCardFilenameParts: partsFor } =
      await import('@/components/dashboard/file-card/layout')
    expect(partsFor('résumé notes draft.pdf')).toEqual({
      start: 'résumé notes draft',
      separator: '',
      tail: '',
      extension: '.pdf',
    })
    for (const separator of [' ', '  ', '\t', '\u00a0']) {
      const name = 'résumé notes' + separator + '.pdf'
      const parts = partsFor(name)
      expect(parts).toEqual({
        start: 'résumé notes',
        separator,
        tail: '',
        extension: '.pdf',
      })
      expect(parts.start + parts.separator + parts.tail + parts.extension).toBe(
        name
      )
    }
  })
})
