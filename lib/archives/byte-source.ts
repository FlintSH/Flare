import type { Readable } from 'node:stream'

import type { StorageProvider } from '@/lib/storage'
import type { RandomAccessFile } from '@/lib/storage/types'

import { ArchiveError } from './errors'

/** Random access to one stored archive without downloading all of it. */
export interface ByteSource {
  readonly size: number
  /** Small reads such as headers and directories; a short read is damage. */
  read(start: number, length: number): Promise<Buffer>
  /** Stream `[start, end)` for entry data. */
  stream(start: number, end: number): Promise<Readable>
  close(): Promise<void>
}

export function truncatedArchive() {
  return new ArchiveError(
    'The archive ends unexpectedly. It may be incomplete or damaged.'
  )
}

/** Ranged requests are expensive on object storage, so keep one read-ahead window. */
const REMOTE_WINDOW = 512 * 1024
const LOCAL_WINDOW = 128 * 1024

export async function openByteSource(
  storage: StorageProvider,
  path: string,
  options: { size?: number; signal?: AbortSignal } = {}
): Promise<ByteSource> {
  options.signal?.throwIfAborted()
  const file = storage.openRandomAccess
    ? await storage.openRandomAccess(path)
    : null
  const size = file?.size ?? options.size ?? (await storage.getFileSize(path))
  if (!Number.isSafeInteger(size) || size < 0)
    throw new ArchiveError('The archive size could not be read.', 500)
  return new StorageByteSource(storage, path, size, file, options.signal)
}

class StorageByteSource implements ByteSource {
  private window: { start: number; bytes: Buffer } | null = null

  constructor(
    private readonly storage: StorageProvider,
    private readonly path: string,
    readonly size: number,
    private readonly file: RandomAccessFile | null,
    private readonly signal?: AbortSignal
  ) {}

  async read(start: number, length: number) {
    this.signal?.throwIfAborted()
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(length) ||
      start < 0 ||
      length < 0 ||
      start + length > this.size
    )
      throw truncatedArchive()
    if (!length) return Buffer.alloc(0)
    const window = this.window
    if (
      window &&
      start >= window.start &&
      start + length <= window.start + window.bytes.length
    )
      return window.bytes.subarray(
        start - window.start,
        start - window.start + length
      )
    const span = Math.min(
      this.size - start,
      Math.max(length, this.file ? LOCAL_WINDOW : REMOTE_WINDOW)
    )
    const bytes = this.file
      ? await this.file.read(start, span)
      : await collect(await this.stream(start, start + span), span)
    if (bytes.length < length) throw truncatedArchive()
    this.window = { start, bytes }
    return bytes.subarray(0, length)
  }

  async stream(start: number, end: number) {
    this.signal?.throwIfAborted()
    if (start < 0 || end > this.size || end <= start) throw truncatedArchive()
    return this.storage.getFileStream(
      this.path,
      { start, end: end - 1 },
      this.signal
    )
  }

  async close() {
    this.window = null
    await this.file?.close()
  }
}

async function collect(stream: Readable, length: number) {
  const chunks: Buffer[] = []
  let total = 0
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      chunks.push(buffer)
      total += buffer.length
      if (total >= length) break
    }
  } finally {
    stream.destroy()
  }
  return Buffer.concat(chunks, total).subarray(0, length)
}
