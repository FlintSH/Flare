import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  auditRetentionSetting,
  startAuditRetentionWorker,
} from '@/lib/audit/retention'

describe('FLARE_AUDIT_RETENTION_DAYS', () => {
  it('keeps every event when unset, empty, or 0', () => {
    for (const value of [undefined, '', '  ', '0', '000'])
      expect(auditRetentionSetting(value)).toEqual({ days: null })
  })

  it('accepts whole days from 1 to 36500', () => {
    expect(auditRetentionSetting('1')).toEqual({ days: 1 })
    expect(auditRetentionSetting(' 365 ')).toEqual({ days: 365 })
    expect(auditRetentionSetting('36500')).toEqual({ days: 36_500 })
  })

  it('rejects anything else and keeps every event', () => {
    for (const value of [
      '-30',
      '1.5',
      '30d',
      '1e3',
      'thirty',
      '0x1e',
      '36501',
      '99999999999999999999',
    ]) {
      const setting = auditRetentionSetting(value)
      expect(setting.days).toBeNull()
      expect(setting.error).toContain('FLARE_AUDIT_RETENTION_DAYS')
    }
  })
})

describe('audit retention worker', () => {
  const state = globalThis as { flareAuditRetention?: unknown }
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    delete state.flareAuditRetention
  })

  it('schedules nothing unless retention is set to a valid number of days', () => {
    vi.useFakeTimers()
    for (const value of [undefined, '0', 'abc', '-1']) {
      startAuditRetentionWorker(value)
      expect(vi.getTimerCount()).toBe(0)
      expect(state.flareAuditRetention).toBeUndefined()
    }
  })

  it('runs shortly after startup and then hourly, once per process', () => {
    vi.useFakeTimers()
    expect(startAuditRetentionWorker('90')).toEqual({ days: 90 })
    // The first run and the hourly interval.
    expect(vi.getTimerCount()).toBe(2)
    startAuditRetentionWorker('90')
    expect(vi.getTimerCount()).toBe(2)
  })
})
