import type { PrismaClient } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  auditRetentionSetting,
  pruneAuditEvents,
  startAuditRetentionWorker,
} from '@/lib/audit/retention'

const audit = vi.hoisted(() => ({ recordAudit: vi.fn() }))
vi.mock('@/lib/audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/audit')>()),
  recordAudit: audit.recordAudit,
}))

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

  const pruned = (complete = true) => ({
    cutoff: new Date(0),
    deleted: complete ? 1 : 5_000,
    complete,
    contended: false,
  })

  it('prunes a minute after startup and then every hour', async () => {
    vi.useFakeTimers()
    const prune = vi.fn(async () => pruned())
    startAuditRetentionWorker('30', { prune })
    await vi.advanceTimersByTimeAsync(59_000)
    expect(prune).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(prune).toHaveBeenCalledTimes(1)
    expect(prune).toHaveBeenLastCalledWith(30)
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(prune).toHaveBeenCalledTimes(2)
  })

  it('continues a backlog a minute later instead of waiting an hour', async () => {
    vi.useFakeTimers()
    const prune = vi
      .fn()
      .mockResolvedValueOnce(pruned(false))
      .mockResolvedValue(pruned())
    startAuditRetentionWorker('30', { prune })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(prune).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(prune).toHaveBeenCalledTimes(2)
    // A complete run doesn't schedule another early one.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(prune).toHaveBeenCalledTimes(2)
  })

  it('never overlaps runs and keeps going after a failed one', async () => {
    vi.useFakeTimers()
    let finish!: () => void
    const prune = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise((resolve) => (finish = () => resolve(pruned())))
      )
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValue(pruned())
    startAuditRetentionWorker('30', { prune })
    await vi.advanceTimersByTimeAsync(60_000)
    // The hourly run arrives while the first is still deleting.
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(prune).toHaveBeenCalledTimes(1)
    finish()
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(prune).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(prune).toHaveBeenCalledTimes(3)
  })
})

describe('pruneAuditEvents', () => {
  it('still records what earlier batches removed when a later batch fails', async () => {
    audit.recordAudit.mockClear()
    let batch = 0
    const client = {
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
        batch++
        if (batch === 3) throw new Error('connection lost')
        return work({
          $queryRaw: async () => [{ locked: true }],
          auditEvent: {
            findMany: async () => [{ id: `a${batch}` }, { id: `b${batch}` }],
            deleteMany: async () => ({ count: 2 }),
          },
        })
      },
    } as unknown as PrismaClient

    await expect(
      pruneAuditEvents(30, { client, batchSize: 2 })
    ).rejects.toThrow('connection lost')
    expect(audit.recordAudit).toHaveBeenCalledTimes(1)
    expect(audit.recordAudit.mock.calls[0][0]).toMatchObject({
      action: 'audit.retention.applied',
      details: { count: 4, complete: false, retentionDays: 30 },
    })
  })
})
