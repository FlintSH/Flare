import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { auditContext } from '@/lib/audit/context'
import {
  type IntervalWorker,
  type IntervalWorkerOptions,
  startIntervalWorker,
} from '@/lib/runtime/interval-worker'

const FAILURE = 'Test work unavailable; retrying on the next poll.'
const warn = vi.fn()
const started: IntervalWorker[] = []

function start(options: Partial<IntervalWorkerOptions> = {}) {
  const worker = startIntervalWorker({
    key: 'test-worker',
    everyMs: 5_000,
    logger: { warn },
    failure: FAILURE,
    run: () => {},
    ...options,
  })
  started.push(worker)
  return worker
}

beforeEach(() => {
  vi.useFakeTimers()
  warn.mockReset()
})
afterEach(() => {
  for (const worker of started.splice(0)) worker.stop()
  // Restore spies before the real timers, or a spy would put a fake timer back.
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('interval workers', () => {
  it('runs once per interval, with one worker per key', async () => {
    const run = vi.fn()
    const worker = start({ run })
    expect(start({ run: vi.fn() })).toBe(worker)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('shares a worker with every copy of the module in the process', async () => {
    const run = vi.fn()
    const worker = start({ run })
    // Route bundles and instrumentation can each load their own copy.
    vi.resetModules()
    const copy = await import('@/lib/runtime/interval-worker')
    expect(copy.startIntervalWorker).not.toBe(startIntervalWorker)
    const second = vi.fn()
    expect(
      copy.startIntervalWorker({
        key: 'test-worker',
        everyMs: 1_000,
        logger: { warn },
        failure: FAILURE,
        run: second,
      })
    ).toBe(worker)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(run).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })

  it('attributes every run to System, not to the request that started it', async () => {
    const stores: unknown[] = []
    const request = { actorId: 'admin-1', actorName: 'Admin' }
    auditContext.run(request, () =>
      start({ run: () => void stores.push(auditContext.getStore()) })
    )
    // Real timers run their callbacks in the context they were created in.
    await auditContext.run(request, () => vi.advanceTimersByTimeAsync(10_000))
    expect(stores).toEqual([
      { actorId: null, actorName: 'System' },
      { actorId: null, actorName: 'System' },
    ])
    // Audit state recorded during one run can't leak into the next.
    expect(stores[0]).not.toBe(stores[1])
  })

  it('skips runs that come due while the previous one is still going', async () => {
    let finish!: () => void
    const run = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (finish = resolve))
      )
    start({ run })
    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(run).toHaveBeenCalledTimes(1)
    finish()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('logs a failed run without its error and runs again on the next interval', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('password=private-detail'))
      .mockImplementationOnce(() => {
        throw new Error('private-detail')
      })
      .mockResolvedValue(undefined)
    start({ run })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(warn.mock.calls).toEqual([[FAILURE]])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(run).toHaveBeenCalledTimes(3)
    expect(warn.mock.calls).toEqual([[FAILURE], [FAILURE]])
  })

  it('can run first after its own delay and add runs before the next interval', async () => {
    const run = vi
      .fn()
      .mockImplementationOnce((worker) => worker.runAgainIn(1_000))
    start({ everyMs: 60_000, firstRunAfterMs: 2_000, run })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(run).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(56_999)
    expect(run).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('never keeps the process alive', () => {
    const interval = vi.spyOn(globalThis, 'setInterval')
    const timeout = vi.spyOn(globalThis, 'setTimeout')
    start({ firstRunAfterMs: 1_000 })
    expect(interval.mock.results[0].value.hasRef()).toBe(false)
    expect(timeout.mock.results[0].value.hasRef()).toBe(false)
  })

  it('stops every timer it scheduled and can start again', async () => {
    const run = vi.fn()
    const worker = start({ everyMs: 60_000, firstRunAfterMs: 1_000, run })
    expect(vi.getTimerCount()).toBe(2)
    worker.stop()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(run).not.toHaveBeenCalled()

    const again = start({ run })
    expect(again).not.toBe(worker)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('lets a run in progress finish after stop without scheduling another', async () => {
    let finish!: () => void
    const run = vi.fn(
      (worker: { runAgainIn(ms: number): void }) =>
        new Promise<void>(
          (resolve) =>
            (finish = () => {
              worker.runAgainIn(1_000)
              resolve()
            })
        )
    )
    const worker = start({ run })
    await vi.advanceTimersByTimeAsync(5_000)
    worker.stop()
    finish()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(run).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
