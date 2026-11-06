import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  process: vi.fn(),
  started: [] as string[],
  failing: undefined as string | undefined,
  startup: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/files/expiry', () => ({
  processDueExpirations: mocks.process,
  pruneFinishedExpirations: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: vi.fn() }),
  loggers: { startup: mocks.startup },
}))
// The file expiry worker stays real, to show startup never waits for a poll.
for (const [path, name] of [
  ['@/lib/audit/retention', 'startAuditRetentionWorker'],
  ['@/lib/auth/security/worker', 'startSecurityCleanupWorker'],
  ['@/lib/email/worker', 'startMailWorker'],
  ['@/lib/integrations/worker', 'startWebhookWorker'],
  ['@/lib/storage/deletion-worker', 'startStorageDeletionWorker'],
  ['@/lib/tags/worker', 'startOcrTagWorker'],
  ['@/lib/startup/memory-monitor', 'startMemoryMonitor'],
])
  vi.doMock(path, () => ({
    [name]: () => {
      if (mocks.failing === name) throw new Error(`${name} failed`)
      mocks.started.push(name)
    },
  }))

const workers = [
  'startSecurityCleanupWorker',
  'startAuditRetentionWorker',
  'startStorageDeletionWorker',
  'startMailWorker',
  'startWebhookWorker',
  'startOcrTagWorker',
]

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  mocks.started.length = 0
  mocks.failing = undefined
})
afterEach(async () => {
  // Starting a running worker returns it, so this stops the one startup started.
  const { startFileExpiryWorker } = await import('@/lib/files/expiry-worker')
  startFileExpiryWorker().stop()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('startup tasks', () => {
  it('starts every worker without waiting for a first poll', async () => {
    mocks.process.mockRejectedValue(new Error('Database unavailable'))
    const { runStartupTasks } = await import('@/lib/startup')
    await runStartupTasks()
    expect(mocks.started).toEqual(workers)
    // The file expiry worker's interval, which hasn't run yet.
    expect(vi.getTimerCount()).toBe(1)
    expect(mocks.process).not.toHaveBeenCalled()
    expect(mocks.startup.error).not.toHaveBeenCalled()
    expect(mocks.startup.info).toHaveBeenCalledWith(
      'Startup tasks completed successfully',
      { duration: expect.any(Number) }
    )
  })

  it('starts the remaining tasks when one fails to start', async () => {
    mocks.failing = 'startSecurityCleanupWorker'
    const { runStartupTasks } = await import('@/lib/startup')
    await expect(runStartupTasks()).resolves.toBeUndefined()
    expect(mocks.started).toEqual(workers.slice(1))
    expect(vi.getTimerCount()).toBe(1)
    expect(mocks.startup.error).toHaveBeenCalledExactlyOnceWith(
      'Startup tasks failed',
      new Error('startSecurityCleanupWorker failed'),
      { task: 'security cleanup' }
    )
    expect(mocks.startup.info).not.toHaveBeenCalledWith(
      'Startup tasks completed successfully',
      expect.anything()
    )
  })

  it('starts the memory monitor only in production', async () => {
    const { runStartupTasks } = await import('@/lib/startup')
    await runStartupTasks()
    expect(mocks.started).toEqual(workers)
    mocks.started.length = 0
    vi.stubEnv('NODE_ENV', 'production')
    await runStartupTasks()
    expect(mocks.started).toEqual([...workers, 'startMemoryMonitor'])
  })

  it('warns every minute while the heap is above 1 GiB', async () => {
    const { startMemoryMonitor } = await vi.importActual<
      typeof import('@/lib/startup/memory-monitor')
    >('@/lib/startup/memory-monitor')
    const usage = {
      rss: 0,
      heapTotal: 1536 * 1024 * 1024,
      heapUsed: 1024 * 1024 * 1024,
      external: 10 * 1024 * 1024,
      arrayBuffers: 0,
    }
    vi.spyOn(process, 'memoryUsage').mockImplementation(() => usage)
    const monitor = startMemoryMonitor()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.startup.warn).not.toHaveBeenCalled()
    usage.heapUsed += 1
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.startup.warn).toHaveBeenCalledExactlyOnceWith(
      'High memory usage detected',
      { heapUsed: '1024MB', heapTotal: '1536MB', external: '10MB' }
    )
    monitor.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
