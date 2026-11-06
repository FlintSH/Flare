import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startSecurityCleanupWorker } from '@/lib/auth/security/worker'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), warn: vi.fn() }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { $executeRaw: mocks.execute },
}))
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ warn: mocks.warn }) }))

let worker: ReturnType<typeof startSecurityCleanupWorker> | undefined
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.execute.mockResolvedValue(0)
})
afterEach(() => {
  worker?.stop()
  worker = undefined
  vi.useRealTimers()
})

describe('authentication retention worker', () => {
  it('starts only one minute poller and prevents overlapping batches', async () => {
    let finish!: (count: number) => void
    mocks.execute.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve
        })
    )
    worker = startSecurityCleanupWorker()
    expect(startSecurityCleanupWorker()).toBe(worker)
    await vi.advanceTimersByTimeAsync(59999)
    expect(mocks.execute).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(120000)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    finish(0)
    await vi.advanceTimersByTimeAsync(1)
    const firstBatch = mocks.execute.mock.calls.length
    await vi.advanceTimersByTimeAsync(60000)
    expect(mocks.execute.mock.calls.length).toBeGreaterThan(firstBatch)
  })
  it('retries a failed cleanup on the next poll without exposing its error', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('private database details'))
    worker = startSecurityCleanupWorker()
    await vi.advanceTimersByTimeAsync(60000)
    expect(mocks.warn.mock.calls).toEqual([
      ['Security cleanup unavailable; retrying on the next poll.'],
    ])
    const failed = mocks.execute.mock.calls.length
    await vi.advanceTimersByTimeAsync(60000)
    expect(mocks.execute.mock.calls.length).toBeGreaterThan(failed)
  })
})
