import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startFileExpiryWorker } from '@/lib/files/expiry-worker'

const mocks = vi.hoisted(() => ({
  process: vi.fn(),
  prune: vi.fn(),
  warn: vi.fn(),
}))
vi.mock('@/lib/files/expiry', () => ({
  processDueExpirations: mocks.process,
  pruneFinishedExpirations: mocks.prune,
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: mocks.warn }),
}))

let worker: ReturnType<typeof startFileExpiryWorker> | undefined

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  mocks.process.mockResolvedValue(undefined)
  mocks.prune.mockResolvedValue(false)
})
afterEach(() => {
  worker?.stop()
  worker = undefined
  vi.useRealTimers()
})

describe('file expiry poller', () => {
  it('polls every 5 seconds, prunes hourly and survives a failed poll', async () => {
    worker = startFileExpiryWorker()
    expect(startFileExpiryWorker()).toBe(worker)
    mocks.process.mockRejectedValueOnce(new Error('Database unavailable'))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.process).toHaveBeenCalledTimes(1)
    expect(mocks.warn).toHaveBeenCalledWith(
      'File expiry is unavailable; retrying on the next poll.'
    )
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.process).toHaveBeenCalledTimes(2)
    expect(mocks.prune).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(mocks.prune).toHaveBeenCalledTimes(2)
  })

  it('keeps pruning on the next poll while full batches remain', async () => {
    mocks.prune.mockResolvedValueOnce(true).mockResolvedValue(false)
    worker = startFileExpiryWorker()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(mocks.prune).toHaveBeenCalledTimes(2)
  })
})
