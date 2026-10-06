import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { finished, pipeline } from 'node:stream/promises'

import { loggers } from '@/lib/logger'
import type { StorageProvider } from '@/lib/storage'

import { ArchiveError } from './errors'
import { ARCHIVE_LIMITS } from './shared'

const activeKey = Symbol.for('flare.archive.active-operations')
const processState = globalThis as typeof globalThis & {
  [key: symbol]: unknown
}
const active = (processState[activeKey] ??= new Set<string>()) as Set<string>
export const ARCHIVE_CONCURRENCY = 2

export class ArchiveOperation {
  private readonly controller = new AbortController()
  private readonly timer: ReturnType<typeof setTimeout>
  private readonly abort: () => void
  private readonly deadline = Date.now() + ARCHIVE_LIMITS.timeoutMs
  private released = false
  private deferred = false
  directory = ''

  constructor(
    private readonly userId: string,
    private readonly requestSignal: AbortSignal
  ) {
    if (active.has(userId) || active.size >= ARCHIVE_CONCURRENCY)
      throw new ArchiveError(
        'Another archive operation is running. Try again shortly.',
        429
      )
    active.add(userId)
    this.abort = () =>
      this.controller.abort(
        new ArchiveError('Archive operation was cancelled.', 408)
      )
    requestSignal.addEventListener('abort', this.abort, { once: true })
    this.timer = setTimeout(
      () =>
        this.controller.abort(
          new ArchiveError(
            'Archive operation exceeded the two-minute time limit.',
            408
          )
        ),
      ARCHIVE_LIMITS.timeoutMs
    )
    this.timer.unref()
    if (requestSignal.aborted) this.abort()
  }

  get signal() {
    return this.controller.signal
  }

  transactionTimeout() {
    this.signal.throwIfAborted()
    return Math.max(1, this.deadline - Date.now())
  }

  async initialize() {
    this.signal.throwIfAborted()
    this.directory = await mkdtemp(join(tmpdir(), 'flare-archive-'))
  }

  path() {
    return join(this.directory, randomUUID())
  }

  async stage(storage: StorageProvider, filePath: string, maxBytes: number) {
    this.signal.throwIfAborted()
    const diskPath = this.path()
    const stream = await storage.getFileStream(filePath, undefined, this.signal)
    let size = 0
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length
        callback(
          size > maxBytes
            ? new ArchiveError('Archive input exceeds the size limit.', 413)
            : null,
          chunk
        )
      },
    })
    await pipeline(
      stream,
      counter,
      createWriteStream(diskPath, { flags: 'wx', mode: 0o600 }),
      { signal: this.signal }
    )
    return { diskPath, size }
  }

  download(
    diskPath: string,
    name: string,
    size: number,
    mimeType = 'application/octet-stream'
  ) {
    this.signal.throwIfAborted()
    const stream = createReadStream(diskPath, { signal: this.signal })
    this.deferred = true
    void finished(stream)
      .catch(() => {})
      .finally(() => this.release())
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(size),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (character) => '%' + character.charCodeAt(0).toString(16))}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'",
      },
    })
  }

  async release(force = true) {
    if (this.released || (!force && this.deferred)) return
    this.released = true
    clearTimeout(this.timer)
    this.requestSignal.removeEventListener('abort', this.abort)
    if (this.directory) {
      await rm(this.directory, { recursive: true, force: true }).catch(
        (error) => {
          loggers.files.warn('Could not remove archive temporary directory', {
            directory: this.directory,
            error,
          })
        }
      )
    }
    active.delete(this.userId)
  }
}

export async function withArchiveOperation<T>(
  userId: string,
  signal: AbortSignal,
  action: (operation: ArchiveOperation) => Promise<T>
) {
  const operation = new ArchiveOperation(userId, signal)
  try {
    await operation.initialize()
    return await action(operation)
  } catch (error) {
    if (operation.signal.aborted) throw operation.signal.reason
    throw error
  } finally {
    await operation.release(false)
  }
}
