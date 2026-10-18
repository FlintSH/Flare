import { Readable, type Transform } from 'node:stream'
import { crc32 } from 'node:zlib'

import { ArchiveError } from './errors'

/** How long reading archive data may go without receiving any bytes. */
export const ARCHIVE_IDLE_MS = 60_000

export function storageStalled() {
  return new ArchiveError(
    'Storage stopped responding while reading the archive. Try again shortly.',
    504
  )
}

/**
 * Emitted by {@link sliceStream} for every decoded chunk, including chunks it
 * skips, so a long seek toward a range counts as activity rather than a stall.
 */
export const SLICE_PROGRESS = 'progress'

/**
 * Read up to `limit` bytes. A storage stream that stops sending bytes
 * without closing fails after {@link ARCHIVE_IDLE_MS} instead of holding
 * its request, file handle, and stream slot indefinitely.
 */
export async function readUpTo(stream: Readable, limit: number) {
  const chunks: Buffer[] = []
  let total = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = () => {
    clearTimeout(timer)
    timer = setTimeout(() => stream.destroy(storageStalled()), ARCHIVE_IDLE_MS)
  }
  stream.on(SLICE_PROGRESS, arm)
  try {
    arm()
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      chunks.push(buffer)
      total += buffer.length
      if (total >= limit) break
      arm()
    }
  } finally {
    clearTimeout(timer)
    stream.off(SLICE_PROGRESS, arm)
    stream.destroy()
  }
  return Buffer.concat(chunks, total).subarray(0, limit)
}

/**
 * Settles only when `signal` aborts. Racing work against it frees what the
 * caller holds even if a storage call ignores cancellation.
 */
export function rejectOnAbort(signal: AbortSignal) {
  return new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason)
    else
      signal.addEventListener('abort', () => reject(signal.reason), {
        once: true,
      })
  })
}

export function damagedEntry() {
  return new ArchiveError(
    'This file’s data in the archive is damaged, so it can’t be read.'
  )
}

function integrityFailed() {
  return new ArchiveError(
    'Archive integrity verification failed. The file may be damaged.'
  )
}

/**
 * Stream `take` bytes after skipping `skip` bytes of decoded output. With
 * `verify`, the whole member is decoded and the final chunk is withheld until
 * its size and CRC-32 match, so a damaged member never looks complete.
 */
export function sliceStream(
  input: Readable,
  decoder: Transform | null,
  skip: number,
  take: number,
  verify?: { crc32: number }
): Readable {
  const output = decoder ?? input
  if (decoder) {
    input.on('error', (error) => decoder.destroy(error))
    input.pipe(decoder)
  }
  async function* slice() {
    let skipped = 0
    let emitted = 0
    let checksum = 0
    let held: Buffer | null = null
    try {
      for await (const received of output) {
        readable.emit(SLICE_PROGRESS)
        let chunk = received as Buffer
        if (verify) {
          checksum = crc32(chunk, checksum)
          if (emitted + (held?.length ?? 0) + chunk.length > take)
            throw integrityFailed()
          if (held) {
            yield held
            emitted += held.length
          }
          held = chunk
          continue
        }
        if (skipped < skip) {
          const dropped = Math.min(skip - skipped, chunk.length)
          skipped += dropped
          chunk = chunk.subarray(dropped)
          if (!chunk.length) continue
        }
        const remaining = take - emitted
        if (chunk.length >= remaining) {
          if (remaining) yield chunk.subarray(0, remaining)
          return
        }
        yield chunk
        emitted += chunk.length
      }
      if (verify) {
        if (emitted + (held?.length ?? 0) !== take || checksum !== verify.crc32)
          throw integrityFailed()
        if (held) yield held
        return
      }
      if (emitted < take) throw damagedEntry()
    } catch (error) {
      // Decoder errors on hostile data are damage, not server faults.
      if (error instanceof ArchiveError) throw error
      if (/^(Z|ZSTD)_/.test((error as { code?: string }).code ?? ''))
        throw damagedEntry()
      throw error
    } finally {
      input.destroy()
      decoder?.destroy()
    }
  }
  const readable = Readable.from(slice(), { objectMode: false })
  const close = readable._destroy
  // The generator sees a return only between chunks it yields, so stop the
  // decoder first; otherwise a long skip keeps running after the reader left.
  readable._destroy = function (error, callback) {
    input.destroy()
    decoder?.destroy()
    close.call(this, error, callback)
  }
  return readable
}

/**
 * Read `parts` one after another as one stream. Each part opens when the one
 * before it ends; destroying the result destroys the part being read.
 */
export function concatStreams(parts: Array<() => Promise<Readable>>) {
  let current: Readable | null = null
  async function* play() {
    for (const open of parts) {
      const part = await open()
      if (readable.destroyed) {
        part.destroy()
        return
      }
      current = part
      part.on(SLICE_PROGRESS, progress)
      try {
        for await (const chunk of part) yield chunk as Buffer
      } finally {
        part.off(SLICE_PROGRESS, progress)
        part.destroy()
        current = null
      }
    }
  }
  const readable = Readable.from(play(), { objectMode: false })
  const progress = () => readable.emit(SLICE_PROGRESS)
  const close = readable._destroy
  readable._destroy = function (error, callback) {
    current?.destroy()
    close.call(this, error, callback)
  }
  return readable
}
