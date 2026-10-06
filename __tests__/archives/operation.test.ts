import { stat, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

import {
  ArchiveOperation,
  withArchiveOperation,
} from '@/lib/archives/operation'
import { ARCHIVE_LIMITS } from '@/lib/archives/shared'
import type { StorageProvider } from '@/lib/storage'

describe('bounded archive operations', () => {
  it('caps concurrency per process and account and releases slots', async () => {
    const first = new ArchiveOperation('first', new AbortController().signal)
    const second = new ArchiveOperation('second', new AbortController().signal)
    try {
      expect(
        () => new ArchiveOperation('first', new AbortController().signal)
      ).toThrow('Another archive operation')
      expect(
        () => new ArchiveOperation('third', new AbortController().signal)
      ).toThrow('Another archive operation')
    } finally {
      await first.release()
      await second.release()
    }
    const next = new ArchiveOperation('first', new AbortController().signal)
    await next.release()
  })
  it('cancels a stalled source stream on disconnect and removes temporary files', async () => {
    const controller = new AbortController()
    let directory = ''
    const source = new Readable({ read() {} })
    const action = withArchiveOperation(
      'cancelled',
      controller.signal,
      async (operation) => {
        directory = operation.directory
        const staged = operation.stage(
          { getFileStream: async () => source } as unknown as StorageProvider,
          'unused',
          10
        )
        setImmediate(() => controller.abort())
        return staged
      }
    )
    await expect(action).rejects.toThrow('cancelled')
    expect(source.destroyed).toBe(true)
    await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('aborts at the absolute two-minute deadline', async () => {
    vi.useFakeTimers()
    const operation = new ArchiveOperation(
      'deadline',
      new AbortController().signal
    )
    try {
      await vi.advanceTimersByTimeAsync(ARCHIVE_LIMITS.timeoutMs)
      expect(operation.signal.aborted).toBe(true)
      expect(operation.signal.reason.message).toContain('two-minute')
    } finally {
      await operation.release()
      vi.useRealTimers()
    }
  })
  it('keeps a downloaded entry alive until the response finishes, then removes the staging directory', async () => {
    let directory = ''
    const response = await withArchiveOperation(
      'download',
      new AbortController().signal,
      async (operation) => {
        directory = operation.directory
        const path = operation.path()
        await writeFile(path, 'entry')
        return operation.download(path, 'entry.txt', 5)
      }
    )
    expect(await response.text()).toBe('entry')
    await expect
      .poll(async () =>
        stat(directory).then(
          () => false,
          () => true
        )
      )
      .toBe(true)
  })
})
