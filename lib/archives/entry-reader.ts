import { Readable } from 'node:stream'
import { createInflateRaw } from 'node:zlib'

import type { ArchiveIndex, IndexedEntry } from './archive-index'
import type { ByteSource } from './byte-source'
import { gzipDiscard, openGzipRange } from './gzip-reader'
import { sliceStream } from './stream-slice'
import { zipDataOffset } from './zip-reader'

/**
 * Decoded bytes {@link openEntryRange} discards before `start`: a deflated ZIP
 * entry decodes from its first byte, and a gzip stream from the closest
 * access point. TAR and stored ZIP data is read directly.
 */
export function discardedBefore(
  index: ArchiveIndex,
  entry: IndexedEntry,
  start: number
) {
  if (index.format === 'tar') return 0
  if (index.format === 'zip') return entry.method === 0 ? 0 : start
  return gzipDiscard(index.gzip, entry.offset + start)
}

/**
 * Open `[start, end)` of an entry's uncompressed bytes. A whole-member read of
 * a ZIP entry is verified against its CRC-32.
 */
export async function openEntryRange(
  source: ByteSource,
  index: ArchiveIndex,
  entry: IndexedEntry,
  start: number,
  end: number
): Promise<Readable> {
  if (end <= start) return Readable.from([], { objectMode: false })
  if (index.format === 'tar')
    return source.stream(entry.offset + start, entry.offset + end)
  if (index.format !== 'zip')
    return openGzipRange(
      source,
      index.gzip,
      entry.offset + start,
      entry.offset + end
    )
  const dataOffset = await zipDataOffset(source, index, entry)
  const whole = start === 0 && end === entry.size
  const verify = whole ? { crc32: entry.crc32 ?? 0 } : undefined
  if (entry.method === 0) {
    if (!whole) return source.stream(dataOffset + start, dataOffset + end)
    return sliceStream(
      await source.stream(dataOffset, dataOffset + entry.size),
      null,
      0,
      entry.size,
      verify
    )
  }
  const compressed = entry.compressedSize ?? 0
  const input = compressed
    ? await source.stream(dataOffset, dataOffset + compressed)
    : Readable.from([], { objectMode: false })
  return sliceStream(input, createInflateRaw(), start, end - start, verify)
}
