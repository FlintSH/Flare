import { describe, expect, it } from 'vitest'

import {
  expiresSoon,
  expiryNotice,
  recordedExpiry,
} from '@/lib/files/expiry-notice'

const now = new Date('2026-11-12T12:00:00Z')
const after = (ms: number) => new Date(now.getTime() + ms)
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('recordedExpiry', () => {
  it('reads the time a file’s upload options record', () => {
    expect(
      recordedExpiry({ expiresAt: '2026-11-23T00:41:39.577Z' })?.toISOString()
    ).toBe('2026-11-23T00:41:39.577Z')
    // Earlier versions stored the upload request's own form.
    expect(
      recordedExpiry({ expiresAt: '2026-11-23T02:00+02:00' })?.toISOString()
    ).toBe('2026-11-23T00:00:00.000Z')
  })

  it('finds none in options without one', () => {
    for (const options of [
      null,
      undefined,
      'DISABLED',
      [],
      {},
      { expiresAt: null },
      { expiresAt: 1794000000000 },
      { expiresAt: 'soon' },
    ])
      expect(recordedExpiry(options), JSON.stringify(options)).toBeNull()
  })
})

describe('expiryNotice', () => {
  it('says how long a file has left', () => {
    expect(expiryNotice(after(21 * DAY), now)).toBe('Expires in 21 days')
    expect(expiryNotice(after(5 * HOUR), now)).toBe('Expires in 5 hours')
    expect(expiryNotice(after(90 * MINUTE), now)).toBe('Expires in 2 hours')
    expect(expiryNotice(after(12 * MINUTE), now)).toBe('Expires in 12 minutes')
    expect(expiryNotice(after(20_000), now)).toBe(
      'Expires in less than a minute'
    )
  })

  // The worker may not have applied a due expiry yet, and a file made
  // private by one keeps its record.
  it('says nothing once the time has passed', () => {
    expect(expiryNotice(now, now)).toBeNull()
    expect(expiryNotice(after(-DAY), now)).toBeNull()
  })
})

describe('expiresSoon', () => {
  it('is within three days', () => {
    expect(expiresSoon(after(2 * DAY), now)).toBe(true)
    expect(expiresSoon(after(4 * DAY), now)).toBe(false)
  })
})
