import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  process: vi.fn(),
  prune: vi.fn(),
  warn: vi.fn(),
  started: [] as string[],
}))
vi.mock('@/lib/files/expiry', () => ({
  processDueExpirations: mocks.process,
  pruneFinishedExpirations: mocks.prune,
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: mocks.warn }),
  loggers: { startup: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}))
for (const [path, name] of [
  ['@/lib/audit/retention', 'startAuditRetentionWorker'],
  ['@/lib/auth/security/worker', 'startSecurityCleanupWorker'],
  ['@/lib/email/worker', 'startMailWorker'],
  ['@/lib/integrations/worker', 'startWebhookWorker'],
  ['@/lib/storage/deletion-worker', 'startStorageDeletionWorker'],
  ['@/lib/tags/worker', 'startOcrTagWorker'],
])
  vi.doMock(path, () => ({ [name]: () => mocks.started.push(name) }))

const state = globalThis as typeof globalThis & {
  flareFileExpiryWorker?: { timer: NodeJS.Timeout }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  mocks.started.length = 0
  mocks.process.mockResolvedValue(undefined)
  mocks.prune.mockResolvedValue(false)
})
afterEach(() => {
  if (state.flareFileExpiryWorker)
    clearInterval(state.flareFileExpiryWorker.timer)
  delete state.flareFileExpiryWorker
  vi.useRealTimers()
})

describe('file expiry poller', () => {
  it('polls every 5 seconds, prunes hourly and survives a failed poll', async () => {
    const { startFileExpiryWorker } = await import('@/lib/files/expiry-worker')
    startFileExpiryWorker()
    startFileExpiryWorker()
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
    const { startFileExpiryWorker } = await import('@/lib/files/expiry-worker')
    mocks.prune.mockResolvedValueOnce(true).mockResolvedValue(false)
    startFileExpiryWorker()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(mocks.prune).toHaveBeenCalledTimes(2)
  })

  it('starts with the other workers without waiting for its first poll', async () => {
    mocks.process.mockRejectedValue(new Error('Database unavailable'))
    const { runStartupTasks } = await import('@/lib/startup')
    await runStartupTasks()
    expect(mocks.started).toEqual([
      'startSecurityCleanupWorker',
      'startAuditRetentionWorker',
      'startStorageDeletionWorker',
      'startMailWorker',
      'startWebhookWorker',
      'startOcrTagWorker',
    ])
    expect(state.flareFileExpiryWorker).toBeDefined()
    expect(mocks.process).not.toHaveBeenCalled()
  })
})
