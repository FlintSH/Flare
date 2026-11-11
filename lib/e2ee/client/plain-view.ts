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
 * Sends a stream through a transform of the browser, such as
 * `DecompressionStream`. The source is read only as fast as the transform
 * takes it. A failure of the source is thrown as it is; a failure of the
 * transform is thrown as `failed()`.
 */
export async function* throughTransform(
  input: AsyncGenerator<Uint8Array, void, undefined>,
  transform: {
    readonly writable: WritableStream<Uint8Array<ArrayBuffer>>
    readonly readable: ReadableStream<Uint8Array>
  },
  failed: () => Error
): AsyncGenerator<Uint8Array, void, undefined> {
  const writer = transform.writable.getWriter()
  const reader = transform.readable.getReader()
  let sourceFailure: unknown
  let stopped = false
  const feeding = (async () => {
    for (;;) {
      let step: IteratorResult<Uint8Array, void>
      try {
        step = await input.next()
      } catch (error) {
        // A failed tag or request, not bad data for the transform.
        if (!stopped) sourceFailure = error
        await writer.abort(error).catch(() => undefined)
        return
      }
      if (step.done || stopped) break
      try {
        await writer.write(step.value as Uint8Array<ArrayBuffer>)
      } catch {
        // The transform refused the data. Its reader reports that.
        return
      }
    }
    if (!stopped) await writer.close().catch(() => undefined)
  })()
  try {
    for (;;) {
      let step: ReadableStreamReadResult<Uint8Array>
      try {
        step = await reader.read()
      } catch {
        await feeding
        throw sourceFailure ?? failed()
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

/** Decodes a compressed stream with the browser's own decoder. */
export function decodeStream(
  input: AsyncGenerator<Uint8Array, void, undefined>,
  format: Decoder
): AsyncGenerator<Uint8Array, void, undefined> {
  return throughTransform(
    input,
    new DecompressionStream(format) as unknown as {
      writable: WritableStream<Uint8Array<ArrayBuffer>>
      readable: ReadableStream<Uint8Array>
    },
    () => new DamagedEntry()
  )
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
  if (!member || typeof member !== 'object' || !safe(member.length))
    throw new DamagedEntry()
  if (member.kind === 'stored') {
    if (!safe(member.offset) || member.offset + member.length > total)
      throw new DamagedEntry()
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
  if (member.kind === 'zip') {
    const compressed = member.compressedLength
    if (
      !safe(member.headerOffset) ||
      !safe(compressed) ||
      !safe(member.dataEnd) ||
      member.dataEnd > total ||
      (member.method !== 0 && member.method !== 8) ||
      (member.method === 0 && compressed !== member.length)
    )
      throw new DamagedEntry()
    // The local header says how long it is. It must name the same method
    // as the directory, and the data must end before the directory.
    let dataOffset: Promise<number> | null = null
    const data = (signal?: AbortSignal) =>
      (dataOffset ??= (async () => {
        if (member.headerOffset + 30 > member.dataEnd) throw new DamagedEntry()
        const header = await source.read(
          member.headerOffset,
          member.headerOffset + 30,
          signal
        )
        const u16 = (at: number) => header[at] | (header[at + 1] << 8)
        if (
          header[0] !== 0x50 ||
          header[1] !== 0x4b ||
          header[2] !== 0x03 ||
          header[3] !== 0x04 ||
          u16(8) !== member.method
        )
          throw new DamagedEntry()
        const offset = member.headerOffset + 30 + u16(26) + u16(28)
        if (offset + compressed > member.dataEnd) throw new DamagedEntry()
        return offset
      })().catch((error: unknown) => {
        dataOffset = null
        throw error
      }))
    return {
      length: member.length,
      discardedBefore: (start) => (member.method === 0 ? 0 : start),
      async *stream(start, end, options) {
        checkRange(member.length, start, end)
        const offset = await data(options?.signal)
        const whole = start === 0 && end === member.length
        if (member.method === 0)
          yield* whole
            ? slice(
                source.stream(offset, offset + compressed, options),
                0,
                end,
                member.length,
                member.crc32
              )
            : source.stream(offset + start, offset + end, options)
        else
          yield* slice(
            decodeStream(
              source.stream(offset, offset + compressed, options),
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
  if (member.kind !== 'gzip' || !safe(member.offset)) throw new DamagedEntry()
  // Bytes of the stream that gzip decoding gives. Its real length is not
  // known before the end, so only the range is checked.
  return {
    length: member.length,
    discardedBefore: (start) => member.offset + start,
    stream(start, end, options) {
      checkRange(member.length, start, end)
      return slice(
        decodeStream(source.stream(0, total, options), 'gzip'),
        member.offset + start,
        member.offset + end,
        null,
        undefined
      )
    },
  }
}
