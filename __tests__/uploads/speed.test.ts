import { describe, expect, it } from 'vitest'

import {
  createSpeedMeter,
  formatSpeed,
  formatTransfer,
} from '@/lib/uploads/speed'

/** A meter on a clock the test moves. */
function meter() {
  let now = 0
  const measure = createSpeedMeter(() => now)
  return (ms: number, bytes: number) => {
    now = ms
    return measure(bytes)
  }
}

const MB = 1024 * 1024

describe('createSpeedMeter', () => {
  it('waits for half a second of progress before giving a speed', () => {
    const at = meter()
    expect(at(0, 0)).toBeNull()
    expect(at(100, 5 * MB)).toBeNull()
    expect(at(500, 5 * MB)).toBe(10 * MB)
  })

  it('follows the last few seconds rather than the whole upload', () => {
    const at = meter()
    at(0, 0)
    // A slow start at 1 MB/s for ten seconds…
    for (let second = 1; second <= 10; second++) at(second * 1000, second * MB)
    // …then 4 MB/s.
    let speed: number | null = null
    for (let second = 11; second <= 14; second++)
      speed = at(second * 1000, 10 * MB + (second - 10) * 4 * MB)
    expect(speed).toBe(4 * MB)
  })

  it('starts again when the byte count goes back, as when a part is retried', () => {
    const at = meter()
    at(0, 0)
    at(1000, 8 * MB)
    expect(at(1100, 2 * MB)).toBeNull()
    expect(at(1600, 3 * MB)).toBe(2 * MB)
  })
})

describe('formatting', () => {
  it('writes a speed per second', () => {
    expect(formatSpeed(12.44 * MB)).toBe('12.4 MB/s')
    expect(formatSpeed(0)).toBe('0 B/s')
  })

  it('adds the speed only while bytes are still going out', () => {
    expect(formatTransfer(4 * MB, 10 * MB, 2 * MB)).toBe(
      '4 MB / 10 MB · 2 MB/s'
    )
    expect(formatTransfer(4 * MB, 10 * MB, null)).toBe('4 MB / 10 MB')
    expect(formatTransfer(10 * MB, 10 * MB, 2 * MB)).toBe('10 MB / 10 MB')
  })
})
