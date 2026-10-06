import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startSecurityCleanupWorker } from '@/lib/auth/security/worker'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), warn: vi.fn() }))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { $executeRaw: mocks.execute },
}))
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ warn: mocks.warn }) }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.execute.mockResolvedValue(0)
})
afterEach(() => {
  const state = globalThis as typeof globalThis & {
    flareSecurityCleanup?: { timer: NodeJS.Timeout }
  }
  if (state.flareSecurityCleanup)
    clearInterval(state.flareSecurityCleanup.timer)
  delete state.flareSecurityCleanup
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
    startSecurityCleanupWorker()
    startSecurityCleanupWorker()
    await vi.advanceTimersByTimeAsync(59999)
    expect(mocks.execute).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(120000)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    finish(0)
    await vi.advanceTimersByTimeAsync(60000)
    expect(mocks.execute).toHaveBeenCalledTimes(6)
    expect(mocks.execute.mock.calls[1][0].join('')).toContain('LoginAttempt')
    expect(mocks.execute.mock.calls[2][0].join('')).toContain('BrowserSession')
  })
  it('retries a failed cleanup on the next poll without exposing its error', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('private database details'))
    startSecurityCleanupWorker()
    await vi.advanceTimersByTimeAsync(60000)
    expect(mocks.warn).toHaveBeenCalledWith(
      'Security cleanup unavailable; retrying on the next poll.'
    )
    await vi.advanceTimersByTimeAsync(60000)
    expect(mocks.execute).toHaveBeenCalledTimes(4)
  })
})
