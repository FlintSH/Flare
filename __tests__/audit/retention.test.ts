import type { PrismaClient } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { configureAuditWriter } from '@/lib/audit'
import {
  auditRetentionSetting,
  pruneAuditEvents,
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
  let worker: ReturnType<typeof startAuditRetentionWorker>
  afterEach(() => {
    worker?.stop()
    worker = undefined
    vi.useRealTimers()
  })

  it('schedules nothing unless retention is set to a valid number of days', () => {
    vi.useFakeTimers()
    for (const value of [undefined, '0', 'abc', '-1']) {
      expect(startAuditRetentionWorker(value)).toBeUndefined()
      expect(vi.getTimerCount()).toBe(0)
    }
  })

  it('runs once per process, however often it is started', async () => {
    vi.useFakeTimers()
    const prune = vi.fn(async () => pruned())
    worker = startAuditRetentionWorker('90', { prune })
    expect(worker).toBeDefined()
    expect(startAuditRetentionWorker('90', { prune })).toBe(worker)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(prune).toHaveBeenCalledTimes(1)
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
    worker = startAuditRetentionWorker('30', { prune })
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
    worker = startAuditRetentionWorker('30', { prune })
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
    worker = startAuditRetentionWorker('30', { prune })
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
    const recorded: Record<string, unknown>[] = []
    configureAuditWriter(async (event) => {
      recorded.push(event)
    })
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
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({
      action: 'audit.retention.applied',
      details: { count: 4, complete: false, retentionDays: 30 },
    })
  })
})
