import { crc32 } from '@/lib/archives/crc32'

import { E2eeError } from '../errors'
import type { LocalMember } from '../sw/protocol'
import type { EncryptedSource, StreamOptions } from './encrypted-source'

/**
 * A run of plaintext bytes that can be read in ranges: a whole decrypted
 * file, or one entry of a decrypted archive (docs/e2ee-spec.md, section
 * 12.3). The service worker answers local addresses from it, and the archive
 * tools read entries through it.
 *
 * The values of an entry (`offset`, `length`, the sizes) come from the
 * archive, which is not trusted. They are checked against the file here,
 * and a compressed entry that gives more bytes than it declared is stopped.
 */
export interface PlainView {
  readonly length: number
  /**
   * Bytes decoded and thrown away before byte `start` can be given: zero
   * for bytes that are read directly.
   */
  discardedBefore(start: number): number
  stream(
    start: number,
    end: number,
    options?: StreamOptions
  ): AsyncGenerator<Uint8Array, void, undefined>
}

/** The entry does not have the bytes it declares. */
export class DamagedEntry extends Error {
  constructor() {
    super('This entry’s data in the archive is damaged, so it can’t be read.')
    this.name = 'DamagedEntry'
  }
}

type Decoder = 'deflate-raw' | 'gzip'

function safe(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/**
 * Decodes a compressed stream with the browser's own decoder. The source is
 * read only as fast as the decoder takes it.
 */
async function* decode(
  input: AsyncGenerator<Uint8Array, void, undefined>,
  format: Decoder
): AsyncGenerator<Uint8Array, void, undefined> {
  const decoder = new DecompressionStream(format)
  const writer = decoder.writable.getWriter()
  const reader = decoder.readable.getReader()
  let sourceFailure: unknown
  let stopped = false
  const feeding = (async () => {
    try {
      for await (const piece of input) {
        if (stopped) break
        await writer.write(piece as Uint8Array<ArrayBuffer>)
      }
      if (!stopped) await writer.close()
    } catch (error) {
      // A failed tag or request, not bad compressed data.
      if (!stopped) sourceFailure = error
      await writer.abort(error).catch(() => undefined)
    }
  })()
  try {
    for (;;) {
      let step: ReadableStreamReadResult<Uint8Array>
      try {
        step = await reader.read()
      } catch {
        await feeding
        throw sourceFailure ?? new DamagedEntry()
      }
      if (step.done) break
      yield step.value
    }
    await feeding
    if (sourceFailure) throw sourceFailure
  } finally {
    stopped = true
    void reader.cancel().catch(() => undefined)
    void input.return(undefined).catch(() => undefined)
    await feeding.catch(() => undefined)
  }
}

/**
 * Bytes `[start, end)` of a decoded stream that must be `length` bytes
 * long. Stops a stream that gives more than `length`. A read of the whole
 * stream checks its length and, if given, its CRC-32.
 */
async function* slice(
  decoded: AsyncGenerator<Uint8Array, void, undefined>,
  start: number,
  end: number,
  length: number | null,
  expectedCrc: number | undefined
): AsyncGenerator<Uint8Array, void, undefined> {
  const whole = length !== null && start === 0 && end === length
  let position = 0
  let checksum = 0
  try {
    for await (const piece of decoded) {
      const pieceEnd = position + piece.length
      if (length !== null && pieceEnd > length) throw new DamagedEntry()
      if (whole && expectedCrc !== undefined) checksum = crc32(piece, checksum)
      if (pieceEnd > start && position < end)
        yield piece.subarray(
          Math.max(0, start - position),
          Math.min(piece.length, end - position)
        )
      position = pieceEnd
      // A partial read needs nothing after its last byte.
      if (!whole && position >= end) return
    }
    if (position < end) throw new DamagedEntry()
    if (
      whole &&
      (position !== length ||
        (expectedCrc !== undefined && checksum !== expectedCrc >>> 0))
    )
      throw new DamagedEntry()
  } finally {
    void decoded.return(undefined).catch(() => undefined)
  }
}

function checkRange(length: number, start: number, end: number) {
  if (!safe(start) || !safe(end) || start > end || end > length)
    throw new E2eeError('invalid_range', 'The range is outside the entry')
}

/** The whole file when `member` is absent, else that entry of it. */
export function plainView(
  source: EncryptedSource,
  member?: LocalMember
): PlainView {
  const total = source.plaintextLength
  if (!member)
    return {
      length: total,
      discardedBefore: () => 0,
      stream: (start, end, options) => source.stream(start, end, options),
    }
  if (!safe(member.offset) || !safe(member.length)) throw new DamagedEntry()
  if (member.kind === 'stored') {
    if (member.offset + member.length > total) throw new DamagedEntry()
    return {
      length: member.length,
      discardedBefore: () => 0,
      stream(start, end, options) {
        checkRange(member.length, start, end)
        return source.stream(
          member.offset + start,
          member.offset + end,
          options
        )
      },
    }
  }
  if (member.kind === 'deflate') {
    const compressed = member.compressedLength
    if (!safe(compressed) || member.offset + compressed > total)
      throw new DamagedEntry()
    return {
      length: member.length,
      discardedBefore: (start) => start,
      stream(start, end, options) {
        checkRange(member.length, start, end)
        return slice(
          decode(
            source.stream(member.offset, member.offset + compressed, options),
            'deflate-raw'
          ),
          start,
          end,
          member.length,
          member.crc32
        )
      },
    }
  }
  // Bytes of the stream that gzip decoding gives. Its real length is not
  // known before the end, so only the range is checked.
  return {
    length: member.length,
    discardedBefore: (start) => member.offset + start,
    stream(start, end, options) {
      checkRange(member.length, start, end)
      return slice(
        decode(source.stream(0, total, options), 'gzip'),
        member.offset + start,
        member.offset + end,
        null,
        undefined
      )
    },
  }
}
