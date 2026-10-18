import { Readable, type Transform } from 'node:stream'
import { crc32 } from 'node:zlib'

import { ArchiveError } from './errors'

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
  return Readable.from(slice(), { objectMode: false })
}
