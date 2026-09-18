import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { applyPendingOcrTags } from '@/lib/tags/ocr'
import { retryPendingOcrTags, startOcrTagWorker } from '@/lib/tags/worker'

const mocks = vi.hoisted(() => ({
  file: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  queryRaw: vi.fn(),
  transaction: vi.fn(),
  applyAutomaticTags: vi.fn(),
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { file: mocks.file, $transaction: mocks.transaction },
}))
vi.mock('@/lib/tags/service', () => ({
  applyAutomaticTags: mocks.applyAutomaticTags,
}))
vi.mock('@/lib/logger', () => ({
  loggers: { ocr: { warn: vi.fn() } },
}))

const now = new Date('2026-09-18T12:00:00.000Z')
const transaction = { file: mocks.file, $queryRaw: mocks.queryRaw }
const globalState = globalThis as typeof globalThis & {
  flareOcrTagWorker?: { timer: NodeJS.Timeout; busy: boolean }
}
type FileState = {
  id: string
  ocrText: string
  ocrTagsPendingAt: Date | null
}
let files: Map<string, FileState>
let afterRollback: (() => void) | undefined

function addFile(id: string, pendingAt: Date | null = now) {
  const file = { id, ocrText: 'Receipt from Acme', ocrTagsPendingAt: pendingAt }
  files.set(id, file)
  return file
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(now)
  files = new Map()
  afterRollback = undefined
  mocks.applyAutomaticTags.mockResolvedValue(1)
  mocks.queryRaw.mockResolvedValue([])
  mocks.file.findUnique.mockImplementation(async ({ where }) => {
    const file = files.get(where.id)
    return file ? { ...file } : null
  })
  mocks.file.findMany.mockImplementation(async ({ where, take }) =>
    [...files.values()]
      .filter(
        (file) =>
          file.ocrTagsPendingAt &&
          file.ocrTagsPendingAt <= where.ocrTagsPendingAt.lte
      )
      .slice(0, take)
      .map(({ id }) => ({ id }))
  )
  mocks.file.update.mockImplementation(async ({ where, data }) => {
    const file = files.get(where.id)
    if (!file) throw new Error('File was deleted')
    Object.assign(file, data)
    return { ...file }
  })
  mocks.file.updateMany.mockImplementation(async ({ where, data }) => {
    const file = files.get(where.id)
    if (
      !file ||
      file.ocrTagsPendingAt?.getTime() !== where.ocrTagsPendingAt.getTime()
    ) {
      return { count: 0 }
    }
    Object.assign(file, data)
    return { count: 1 }
  })
  mocks.transaction.mockImplementation(async (callback) => {
    const original = structuredClone(files)
    try {
      return await callback(transaction)
    } catch (error) {
      files = original
      afterRollback?.()
      throw error
    }
  })
})
afterEach(() => {
  if (globalState.flareOcrTagWorker) {
    clearInterval(globalState.flareOcrTagWorker.timer)
    delete globalState.flareOcrTagWorker
  }
  vi.useRealTimers()
})

describe('durable OCR tag retries', () => {
  it('recovers pending tags after a transient failure without an OCR request', async () => {
    addFile('pending')
    addFile('already-done', null)
    addFile('future', new Date(now.getTime() + 120_000))
    mocks.applyAutomaticTags.mockRejectedValueOnce(new Error('Database busy'))

    await retryPendingOcrTags()
    expect(files.get('pending')).toEqual({
      id: 'pending',
      ocrText: 'Receipt from Acme',
      ocrTagsPendingAt: new Date(now.getTime() + 60_000),
    })
    await retryPendingOcrTags()
    expect(mocks.applyAutomaticTags).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date(now.getTime() + 60_000))
    await retryPendingOcrTags()
    expect(files.get('pending')?.ocrTagsPendingAt).toBeNull()
    await retryPendingOcrTags()
    expect(mocks.applyAutomaticTags).toHaveBeenCalledTimes(2)
    expect(mocks.applyAutomaticTags).toHaveBeenLastCalledWith(
      'pending',
      'ocr',
      transaction
    )
    expect(files.get('future')?.ocrTagsPendingAt).not.toBeNull()
  })

  it('continues the batch after one failed file and skips deleted or completed work', async () => {
    addFile('failing')
    addFile('pending')
    addFile('completed', null)
    // These were pending when selected, but another worker finished/deleted them.
    mocks.file.findMany.mockResolvedValue([
      { id: 'failing' },
      { id: 'completed' },
      { id: 'deleted' },
      { id: 'pending' },
    ])
    mocks.applyAutomaticTags.mockRejectedValueOnce(new Error('Database busy'))

    await expect(retryPendingOcrTags()).resolves.toBeUndefined()
    expect(mocks.applyAutomaticTags.mock.calls.map(([id]) => id)).toEqual([
      'failing',
      'pending',
    ])
    expect(files.get('pending')?.ocrTagsPendingAt).toBeNull()
    expect(files.get('failing')?.ocrTagsPendingAt).not.toBeNull()
    expect(files.has('deleted')).toBe(false)
  })

  it.each(['completed', 'new-result'])(
    'does not overwrite %s work when an older failed attempt reschedules',
    async (change) => {
      addFile('pending')
      const replacement =
        change === 'completed' ? null : new Date(now.getTime() + 1_000)
      mocks.applyAutomaticTags.mockRejectedValueOnce(new Error('Database busy'))
      afterRollback = () => {
        files.get('pending')!.ocrTagsPendingAt = replacement
      }

      await applyPendingOcrTags('pending')
      expect(files.get('pending')?.ocrTagsPendingAt).toEqual(replacement)
      expect(mocks.file.updateMany).toHaveBeenCalledWith({
        where: { id: 'pending', ocrTagsPendingAt: now },
        data: { ocrTagsPendingAt: new Date(now.getTime() + 60_000) },
      })
    }
  )

  it('retains work when the database cannot read or reschedule the attempt', async () => {
    addFile('pending')
    mocks.transaction.mockRejectedValueOnce(new Error('Connection unavailable'))
    await expect(applyPendingOcrTags('pending')).resolves.toBeUndefined()
    expect(files.get('pending')?.ocrTagsPendingAt).toEqual(now)
    expect(mocks.file.updateMany).not.toHaveBeenCalled()

    mocks.applyAutomaticTags.mockRejectedValueOnce(new Error('Database busy'))
    mocks.file.updateMany.mockRejectedValueOnce(
      new Error('Connection unavailable')
    )
    await expect(applyPendingOcrTags('pending')).resolves.toBeUndefined()
    expect(files.get('pending')?.ocrTagsPendingAt).toEqual(now)

    await retryPendingOcrTags()
    expect(files.get('pending')?.ocrTagsPendingAt).toBeNull()
    expect(files.get('pending')?.ocrText).toBe('Receipt from Acme')
  })
})

describe('OCR tag worker polling', () => {
  it('starts one poller and prevents overlapping batches', async () => {
    addFile('pending')
    let finish: (() => void) | undefined
    mocks.applyAutomaticTags.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve))
    )
    startOcrTagWorker()
    startOcrTagWorker()

    await vi.advanceTimersByTimeAsync(15_000)
    expect(mocks.file.findMany).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mocks.file.findMany).toHaveBeenCalledTimes(1)

    finish!()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(mocks.file.findMany).toHaveBeenCalledTimes(2)
    expect(mocks.applyAutomaticTags).toHaveBeenCalledTimes(1)
    expect(files.get('pending')?.ocrTagsPendingAt).toBeNull()
  })

  it('resumes polling after a database outage', async () => {
    addFile('pending')
    mocks.file.findMany.mockRejectedValueOnce(
      new Error('Connection unavailable')
    )
    startOcrTagWorker()

    await vi.advanceTimersByTimeAsync(15_000)
    expect(mocks.applyAutomaticTags).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(mocks.applyAutomaticTags).toHaveBeenCalledTimes(1)
    expect(files.get('pending')?.ocrTagsPendingAt).toBeNull()
  })
})
