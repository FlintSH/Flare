import { describe, expect, it } from 'vitest'

import { parseByteRange } from '@/lib/http/byte-range'

describe('single byte-range parsing', () => {
  it('serves the whole file without a usable Range header', () => {
    for (const header of [
      null,
      '',
      'bytes=',
      'bytes=-',
      'bytes=abc-',
      'bytes=1-abc',
      'bytes=5-2',
      'bytes=0-1,4-5',
      'bytes=0-1, 4-5',
      'items=0-1',
      'bytes 0-1',
      'bytes=-1-2',
      'bytes=0x10-',
      'bytes=1.5-3',
    ])
      expect(parseByteRange(header, 100)).toBeNull()
  })

  it('reads first-last, open-ended, and suffix ranges with inclusive ends', () => {
    expect(parseByteRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 })
    expect(parseByteRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 })
    expect(parseByteRange('bytes=-5', 100)).toEqual({ start: 95, end: 99 })
    expect(parseByteRange('bytes=99-99', 100)).toEqual({ start: 99, end: 99 })
    expect(parseByteRange(' bytes=0-0 ', 100)).toEqual({ start: 0, end: 0 })
    expect(parseByteRange('Bytes=0-0', 100)).toEqual({ start: 0, end: 0 })
    expect(parseByteRange('bytes=007-008', 100)).toEqual({ start: 7, end: 8 })
  })

  it('clamps ranges that run past the end of the file', () => {
    expect(parseByteRange('bytes=50-500', 100)).toEqual({ start: 50, end: 99 })
    expect(parseByteRange('bytes=0-999999999999999999999', 100)).toEqual({
      start: 0,
      end: 99,
    })
    expect(parseByteRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 })
    expect(parseByteRange(`bytes=-${'9'.repeat(400)}`, 100)).toEqual({
      start: 0,
      end: 99,
    })
  })

  it('reports ranges no byte of the file can satisfy', () => {
    for (const header of [
      'bytes=100-',
      'bytes=100-200',
      'bytes=999999999999999999999-',
      'bytes=-0',
    ])
      expect(parseByteRange(header, 100)).toBe('unsatisfiable')
    for (const header of ['bytes=0-', 'bytes=0-0', 'bytes=-1'])
      expect(parseByteRange(header, 0)).toBe('unsatisfiable')
    expect(parseByteRange('bytes=0-1,4-5', 0)).toBeNull()
  })
})
