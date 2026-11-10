import { throughTransform } from '@/lib/e2ee/client/plain-view'

import { crc32 } from '../crc32'

/**
 * Writes ZIP and TAR.GZ archives in the browser as streams
 * (docs/e2ee-spec.md, sections 12.3 and 12.4). Each writer is an async
 * generator: it reads one input at a time and yields the bytes of the
 * archive, so nothing larger than a piece of a file is held in memory. The
 * consumer sets the pace.
 */

export interface ArchiveInput {
  /** The path of the entry in the archive. Slash-separated, relative. */
  readonly name: string
  readonly date?: Date
  /**
   * The size in bytes, where it is known before the bytes are read. TAR
   * needs it. ZIP uses it to choose the 64-bit form for an entry of 4 GiB
   * or more; an entry without a size gets the 64-bit form.
   */
  readonly size?: number
  /**
   * A size that is expected and not required, such as the size a database
   * lists for a file. ZIP uses it only to choose the 64-bit form.
   */
  readonly sizeHint?: number
  /** Opens the bytes. Called when the writer reaches the entry. */
  open(): AsyncIterable<Uint8Array> | Promise<AsyncIterable<Uint8Array>>
}

export interface WrittenEntry {
  readonly name: string
  readonly size: number
  readonly crc32: number
}

export interface WriterOptions {
  readonly compress?: boolean
  /** Called after each entry is complete. */
  readonly onEntry?: (entry: WrittenEntry) => void
  /**
   * Called when an input fails. Return true to leave the entry out and go
   * on (the export); without it the writer throws (an archive a person
   * asked for must be complete).
   */
  readonly onFailure?: (input: ArchiveInput, error: unknown) => boolean
  /** Called with the plaintext bytes read from the inputs so far. */
  readonly onProgress?: (bytes: number) => void
}

const encoder = new TextEncoder()
const MAX_U32 = 0xffffffff
/** Sizes from here on use the 64-bit fields. Deflate can grow data a little. */
const ZIP64_FROM = 0xfff00000

function compressionAvailable(format: 'deflate-raw' | 'gzip') {
  if (typeof CompressionStream === 'undefined') return false
  try {
    new CompressionStream(format)
    return true
  } catch {
    return false
  }
}

function compress(
  input: AsyncGenerator<Uint8Array, void, undefined>,
  format: 'deflate-raw' | 'gzip'
) {
  return throughTransform(
    input,
    new CompressionStream(format) as unknown as {
      writable: WritableStream<Uint8Array<ArrayBuffer>>
      readable: ReadableStream<Uint8Array>
    },
    () => new Error('The data could not be compressed')
  )
}

class Fields {
  private readonly view: DataView
  private offset = 0
  readonly bytes: Uint8Array

  constructor(length: number) {
    this.bytes = new Uint8Array(length)
    this.view = new DataView(this.bytes.buffer)
  }

  u16(value: number) {
    this.view.setUint16(this.offset, value, true)
    this.offset += 2
    return this
  }

  u32(value: number) {
    this.view.setUint32(this.offset, value >>> 0, true)
    this.offset += 4
    return this
  }

  u64(value: number) {
    this.view.setUint32(this.offset, value % 0x100000000, true)
    this.view.setUint32(this.offset + 4, Math.floor(value / 0x100000000), true)
    this.offset += 8
    return this
  }

  raw(bytes: Uint8Array) {
    this.bytes.set(bytes, this.offset)
    this.offset += bytes.length
    return this
  }
}

/** MS-DOS time and date, in UTC so every browser writes the same bytes. */
function dosTime(date: Date) {
  const year = Math.min(2107, Math.max(1980, date.getUTCFullYear()))
  return {
    time:
      (date.getUTCHours() << 11) |
      (date.getUTCMinutes() << 5) |
      (date.getUTCSeconds() >> 1),
    date:
      ((year - 1980) << 9) |
      ((date.getUTCMonth() + 1) << 5) |
      date.getUTCDate(),
  }
}

interface ZipRecord {
  name: Uint8Array
  method: number
  time: number
  date: number
  crc: number
  compressedSize: number
  size: number
  offset: number
  zip64: boolean
}

/**
 * A ZIP archive. Entries are deflated where the browser has
 * `CompressionStream`, and stored elsewhere. Sizes and the CRC-32 follow
 * each entry in a data descriptor, so no entry is read twice. Names are
 * UTF-8. An entry or an archive of 4 GiB or more uses ZIP64.
 */
export async function* zipBytes(
  inputs: Iterable<ArchiveInput> | AsyncIterable<ArchiveInput>,
  options: WriterOptions = {}
): AsyncGenerator<Uint8Array, void, undefined> {
  const deflate =
    options.compress !== false && compressionAvailable('deflate-raw')
  const records: ZipRecord[] = []
  let offset = 0
  let read = 0
  const emit = (bytes: Uint8Array) => {
    offset += bytes.length
    return bytes
  }
  for await (const input of inputs) {
    const name = encoder.encode(input.name)
    if (!name.length || name.length > 0xffff)
      throw new Error('An archive entry name is empty or too long')
    const expected = input.size ?? input.sizeHint
    const zip64 = expected === undefined || expected >= ZIP64_FROM
    const method = deflate ? 8 : 0
    const stamp = dosTime(input.date ?? new Date())
    const record: ZipRecord = {
      name,
      method,
      ...stamp,
      crc: 0,
      compressedSize: 0,
      size: 0,
      offset,
      zip64,
    }
    // Local header: sizes follow in the data descriptor (flag bit 3), and
    // the name is UTF-8 (flag bit 11).
    yield emit(
      new Fields(30 + name.length + (zip64 ? 20 : 0))
        .u32(0x04034b50)
        .u16(zip64 ? 45 : 20)
        .u16(0x0808)
        .u16(method)
        .u16(stamp.time)
        .u16(stamp.date)
        .u32(0)
        .u32(zip64 ? MAX_U32 : 0)
        .u32(zip64 ? MAX_U32 : 0)
        .u16(name.length)
        .u16(zip64 ? 20 : 0)
        .raw(name)
        .raw(
          zip64
            ? new Fields(20).u16(0x0001).u16(16).u64(0).u64(0).bytes
            : new Uint8Array(0)
        ).bytes
    )
    let failure: { error: unknown } | null = null
    try {
      const opened = await input.open()
      const counted = (async function* () {
        for await (const piece of opened) {
          record.crc = crc32(piece, record.crc)
          record.size += piece.length
          read += piece.length
          options.onProgress?.(read)
          yield piece
        }
      })()
      for await (const piece of deflate
        ? compress(counted, 'deflate-raw')
        : counted) {
        record.compressedSize += piece.length
        yield emit(piece)
      }
      if (input.size !== undefined && record.size !== input.size)
        throw new Error('An entry does not have the size it declared')
      if (!zip64 && (record.size > MAX_U32 || record.compressedSize > MAX_U32))
        throw new Error('An entry is too large for its header')
    } catch (error) {
      failure = { error }
    }
    if (failure) {
      // The bytes written for this entry stay in the file, and no reader
      // sees them: the entry is not in the central directory.
      if (!options.onFailure?.(input, failure.error)) throw failure.error
      continue
    }
    yield emit(
      zip64
        ? new Fields(24)
            .u32(0x08074b50)
            .u32(record.crc)
            .u64(record.compressedSize)
            .u64(record.size).bytes
        : new Fields(16)
            .u32(0x08074b50)
            .u32(record.crc)
            .u32(record.compressedSize)
            .u32(record.size).bytes
    )
    records.push(record)
    options.onEntry?.({
      name: input.name,
      size: record.size,
      crc32: record.crc,
    })
  }

  const directoryStart = offset
  for (const record of records) {
    const farOffset = record.offset >= MAX_U32
    const wide = record.zip64 || farOffset
    const extra = wide
      ? (() => {
          const fields = new Fields(
            4 + (record.zip64 ? 16 : 0) + (farOffset ? 8 : 0)
          )
            .u16(0x0001)
            .u16((record.zip64 ? 16 : 0) + (farOffset ? 8 : 0))
          if (record.zip64) fields.u64(record.size).u64(record.compressedSize)
          if (farOffset) fields.u64(record.offset)
          return fields.bytes
        })()
      : new Uint8Array(0)
    yield emit(
      new Fields(46 + record.name.length + extra.length)
        .u32(0x02014b50)
        // Made by: UNIX, so the external attributes carry a file mode.
        .u16((3 << 8) | 45)
        .u16(wide ? 45 : 20)
        .u16(0x0808)
        .u16(record.method)
        .u16(record.time)
        .u16(record.date)
        .u32(record.crc)
        .u32(record.zip64 ? MAX_U32 : record.compressedSize)
        .u32(record.zip64 ? MAX_U32 : record.size)
        .u16(record.name.length)
        .u16(extra.length)
        .u16(0)
        .u16(0)
        .u16(0)
        // A regular file, rw-r--r--.
        .u32((0o100644 << 16) >>> 0)
        .u32(farOffset ? MAX_U32 : record.offset)
        .raw(record.name)
        .raw(extra).bytes
    )
  }
  const directorySize = offset - directoryStart
  const many = records.length >= 0xffff
  if (many || directoryStart >= MAX_U32 || directorySize >= MAX_U32) {
    const zip64End = offset
    yield emit(
      new Fields(56)
        .u32(0x06064b50)
        .u64(44)
        .u16((3 << 8) | 45)
        .u16(45)
        .u32(0)
        .u32(0)
        .u64(records.length)
        .u64(records.length)
        .u64(directorySize)
        .u64(directoryStart).bytes
    )
    yield emit(new Fields(20).u32(0x07064b50).u32(0).u64(zip64End).u32(1).bytes)
  }
  yield emit(
    new Fields(22)
      .u32(0x06054b50)
      .u16(0)
      .u16(0)
      .u16(Math.min(records.length, 0xffff))
      .u16(Math.min(records.length, 0xffff))
      .u32(Math.min(directorySize, MAX_U32))
      .u32(Math.min(directoryStart, MAX_U32))
      .u16(0).bytes
  )
}

function octal(value: number, length: number) {
  return encoder.encode(value.toString(8).padStart(length - 1, '0') + '\0')
}

function tarHeader(
  name: Uint8Array,
  size: number,
  date: Date,
  typeflag: string
) {
  const block = new Uint8Array(512)
  block.set(name.subarray(0, 100), 0)
  block.set(octal(0o644, 8), 100)
  block.set(octal(0, 8), 108)
  block.set(octal(0, 8), 116)
  block.set(octal(size, 12), 124)
  block.set(octal(Math.max(0, Math.floor(date.getTime() / 1000)), 12), 136)
  block.fill(0x20, 148, 156)
  block[156] = typeflag.charCodeAt(0)
  block.set(encoder.encode('ustar\0' + '00'), 257)
  let sum = 0
  for (const byte of block) sum += byte
  block.set(encoder.encode(sum.toString(8).padStart(6, '0') + '\0 '), 148)
  return block
}

const padding = (size: number) => new Uint8Array((512 - (size % 512)) % 512)

/** One PAX record: `<length> <key>=<value>\n`, where the length counts itself. */
function paxRecord(key: string, value: string) {
  const body = encoder.encode(` ${key}=${value}\n`)
  let length = body.length + 1
  while (String(length).length + body.length !== length)
    length = String(length).length + body.length
  const out = new Uint8Array(length)
  out.set(encoder.encode(String(length)))
  out.set(body, String(length).length)
  return out
}

/**
 * A TAR archive (ustar, with a PAX header for a name that is long or not
 * ASCII). Each input needs its exact `size`.
 */
export async function* tarBytes(
  inputs: Iterable<ArchiveInput> | AsyncIterable<ArchiveInput>,
  options: WriterOptions = {}
): AsyncGenerator<Uint8Array, void, undefined> {
  let read = 0
  for await (const input of inputs) {
    if (input.size === undefined || input.size >= 8 * 1024 ** 3)
      throw new Error('A TAR entry needs its size, below 8 GiB')
    const name = encoder.encode(input.name)
    const date = input.date ?? new Date()
    const plain = name.length <= 100 && name.every((byte) => byte < 0x80)
    if (!plain) {
      const record = paxRecord('path', input.name)
      yield tarHeader(
        encoder.encode('PaxHeader/entry'),
        record.length,
        date,
        'x'
      )
      yield record
      yield padding(record.length)
    }
    // A reader without PAX support gets an ASCII name of the same entry.
    yield tarHeader(
      plain
        ? name
        : encoder.encode(input.name.replace(/[^\x20-\x7e]/g, '_').slice(-100)),
      input.size,
      date,
      '0'
    )
    let size = 0
    let checksum = 0
    for await (const piece of await input.open()) {
      size += piece.length
      read += piece.length
      if (size > input.size)
        throw new Error('An entry does not have the size it declared')
      checksum = crc32(piece, checksum)
      options.onProgress?.(read)
      yield piece
    }
    if (size !== input.size)
      throw new Error('An entry does not have the size it declared')
    yield padding(size)
    options.onEntry?.({ name: input.name, size, crc32: checksum })
  }
  yield new Uint8Array(1024)
}

/** A TAR.GZ archive: the TAR above through the browser's gzip encoder. */
export function tarGzBytes(
  inputs: Iterable<ArchiveInput> | AsyncIterable<ArchiveInput>,
  options: WriterOptions = {}
): AsyncGenerator<Uint8Array, void, undefined> {
  if (!compressionAvailable('gzip'))
    throw new Error('This browser cannot write GZIP data')
  return compress(tarBytes(inputs, options), 'gzip')
}

/** Whether this browser can write a TAR.GZ archive. */
export function canWriteTarGz() {
  return compressionAvailable('gzip')
}
