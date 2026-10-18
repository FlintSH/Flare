import { crc32 } from 'node:zlib'
import * as zlib from 'node:zlib'

import { type ArchiveIndex, normalizeBrowsePath } from './archive-index'
import type { ByteSource } from './byte-source'
import { ArchiveError } from './errors'
import type { ArchiveEntryIssue } from './shared'
import { damagedEntry } from './stream-slice'

const EOCD = 0x06054b50
const ZIP64_LOCATOR = 0x07064b50
const ZIP64_EOCD = 0x06064b50
const CENTRAL_HEADER = 0x02014b50
const LOCAL_HEADER = 0x04034b50
const MAX_U32 = 0xffffffff

/** Methods Flare can stream for previews. Extraction accepts only 0 and 8. */
export const PREVIEW_ZIP_METHODS = new Set([
  0,
  8,
  ...(typeof zlib.createZstdDecompress === 'function' ? [93] : []),
])

// IBM PC code page 437, the ZIP default when the UTF-8 flag is absent.
const CP437 =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ '
const strictUtf8 = new TextDecoder('utf-8', { fatal: true })
const lenientUtf8 = new TextDecoder('utf-8')

function damaged(message = 'This ZIP archive is damaged or incomplete.') {
  return new ArchiveError(message)
}

function u64(buffer: Buffer, offset: number) {
  const value = buffer.readBigUInt64LE(offset)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw damaged()
  return Number(value)
}

/**
 * Names without the UTF-8 flag are officially CP437, but macOS and many
 * Linux tools write UTF-8 without setting it. Prefer valid UTF-8.
 */
export function decodeZipName(raw: Buffer, utf8Flag: boolean) {
  if (utf8Flag) return lenientUtf8.decode(raw)
  if (raw.every((byte) => byte < 0x80)) return raw.toString('latin1')
  try {
    return strictUtf8.decode(raw)
  } catch {
    let name = ''
    for (const byte of raw)
      name += byte < 0x80 ? String.fromCharCode(byte) : CP437[byte - 0x80]
    return name
  }
}

function extraField(extra: Buffer, id: number) {
  for (let offset = 0; offset + 4 <= extra.length;) {
    const header = extra.readUInt16LE(offset)
    const length = extra.readUInt16LE(offset + 2)
    if (offset + 4 + length > extra.length) return null
    if (header === id) return extra.subarray(offset + 4, offset + 4 + length)
    offset += 4 + length
  }
  return null
}

interface ZipLayout {
  entryCount: number
  directoryStart: number
  directorySize: number
  /** Bytes prepended to the archive, such as a self-extractor stub. */
  shift: number
}

async function locate(source: ByteSource): Promise<ZipLayout> {
  if (source.size < 22)
    throw damaged('This file is too small to be a ZIP archive.')
  const tailLength = Math.min(source.size, 22 + 0xffff)
  const tailStart = source.size - tailLength
  const tail = await source.read(tailStart, tailLength)
  let record = -1
  let fallback = -1
  for (let index = tail.length - 22; index >= 0; index--) {
    if (tail.readUInt32LE(index) !== EOCD) continue
    const end = index + 22 + tail.readUInt16LE(index + 20)
    if (end === tail.length) {
      record = index
      break
    }
    // Tolerate trailing bytes after the comment, as unzip does.
    if (fallback < 0 && end <= tail.length) fallback = index
  }
  if (record < 0) record = fallback
  if (record < 0)
    throw damaged(
      'Flare couldn’t find this ZIP archive’s file list. The file may be incomplete, damaged, or not a ZIP archive.'
    )
  const position = tailStart + record
  let disk = tail.readUInt16LE(record + 4)
  let directoryDisk = tail.readUInt16LE(record + 6)
  let entryCount = tail.readUInt16LE(record + 10)
  let directorySize = tail.readUInt32LE(record + 12)
  let directoryOffset = tail.readUInt32LE(record + 16)
  let directoryEnd = position
  if (position >= 20) {
    const locator = await source.read(position - 20, 20)
    if (locator.readUInt32LE(0) === ZIP64_LOCATOR) {
      if (locator.readUInt32LE(16) > 1) throw splitArchive()
      const recorded = u64(locator, 8)
      // A prepended stub shifts the recorded offset; the record normally sits
      // immediately before its locator.
      const candidates = [recorded, position - 20 - 56]
      let zip64: Buffer | null = null
      for (const candidate of candidates) {
        if (candidate < 0 || candidate + 56 > position - 20) continue
        const bytes = await source.read(candidate, 56)
        if (bytes.readUInt32LE(0) === ZIP64_EOCD) {
          zip64 = bytes
          directoryEnd = candidate
          break
        }
      }
      if (!zip64) throw damaged()
      disk = zip64.readUInt32LE(16)
      directoryDisk = zip64.readUInt32LE(20)
      entryCount = u64(zip64, 32)
      directorySize = u64(zip64, 40)
      directoryOffset = u64(zip64, 48)
    }
  }
  if (disk !== 0 || directoryDisk !== 0) throw splitArchive()
  const shift = directoryEnd - (directoryOffset + directorySize)
  if (shift < 0) throw damaged()
  return {
    entryCount,
    directoryStart: directoryOffset + shift,
    directorySize,
    shift,
  }
}

function splitArchive() {
  return new ArchiveError(
    'Split or multi-part ZIP archives aren’t supported. Combine the parts into one ZIP before uploading.',
    415
  )
}

/** List a ZIP from its central directory without reading member data. */
export async function indexZip(
  source: ByteSource,
  index: ArchiveIndex,
  limits: { entries: number; directoryBytes: number }
) {
  const layout = await locate(source)
  index.entryCount = layout.entryCount
  index.dataEnd = layout.directoryStart
  const readable = Math.min(layout.directorySize, limits.directoryBytes)
  const directory = await source.read(layout.directoryStart, readable)
  index.bytesRead = readable
  let offset = 0
  for (let count = 0; count < layout.entryCount; count++) {
    if (index.entries.length >= limits.entries) {
      index.truncated = 'entries'
      break
    }
    if (offset + 46 > directory.length) {
      if (readable < layout.directorySize) index.truncated = 'size'
      else if (index.entries.length) index.truncated = 'damaged'
      else throw damaged()
      break
    }
    if (directory.readUInt32LE(offset) !== CENTRAL_HEADER) {
      if (!index.entries.length) throw damaged()
      index.truncated = 'damaged'
      break
    }
    const flags = directory.readUInt16LE(offset + 8)
    const method = directory.readUInt16LE(offset + 10)
    const checksum = directory.readUInt32LE(offset + 16)
    let compressedSize = directory.readUInt32LE(offset + 20)
    let size = directory.readUInt32LE(offset + 24)
    const nameLength = directory.readUInt16LE(offset + 28)
    const extraLength = directory.readUInt16LE(offset + 30)
    const commentLength = directory.readUInt16LE(offset + 32)
    const external = directory.readUInt32LE(offset + 38)
    let headerOffset = directory.readUInt32LE(offset + 42)
    const nameStart = offset + 46
    const next = nameStart + nameLength + extraLength + commentLength
    if (next > directory.length) {
      if (readable < layout.directorySize) index.truncated = 'size'
      else if (index.entries.length) index.truncated = 'damaged'
      else throw damaged()
      break
    }
    const rawName = directory.subarray(nameStart, nameStart + nameLength)
    const extra = directory.subarray(
      nameStart + nameLength,
      nameStart + nameLength + extraLength
    )
    offset = next
    let issue: ArchiveEntryIssue | undefined
    if (
      size === MAX_U32 ||
      compressedSize === MAX_U32 ||
      headerOffset === MAX_U32
    ) {
      const zip64 = extraField(extra, 0x0001)
      let cursor = 0
      const take = () => {
        if (!zip64 || cursor + 8 > zip64.length) {
          issue = 'damaged'
          return 0
        }
        const value = u64(zip64, cursor)
        cursor += 8
        return value
      }
      if (size === MAX_U32) size = take()
      if (compressedSize === MAX_U32) compressedSize = take()
      if (headerOffset === MAX_U32) headerOffset = take()
    }
    let name = decodeZipName(rawName, (flags & 0x800) !== 0)
    const unicode = extraField(extra, 0x7075)
    if (
      unicode &&
      unicode.length > 5 &&
      unicode[0] === 1 &&
      unicode.readUInt32LE(1) === crc32(rawName)
    )
      name = lenientUtf8.decode(unicode.subarray(5))
    const unixType = (external >>> 16) & 0o170000
    const directoryEntry =
      name.endsWith('/') || unixType === 0o040000 || (external & 0x10) !== 0
    const normalized = normalizeBrowsePath(name)
    if (!normalized.path) continue
    if (flags & 0x41 || method === 99) issue ??= 'encrypted'
    else if (unixType === 0o120000) issue ??= 'link'
    else if (unixType && unixType !== 0o100000 && unixType !== 0o040000)
      issue ??= 'special'
    else if (!directoryEntry && !PREVIEW_ZIP_METHODS.has(method))
      issue ??= 'compression'
    if (normalized.unsafe) issue ??= 'unsafe-path'
    const localOffset = headerOffset + layout.shift
    if (
      !directoryEntry &&
      !issue &&
      (localOffset + 30 + compressedSize > layout.directoryStart ||
        (method === 0 && compressedSize !== size) ||
        // Deflate cannot expand data by more than about 1032:1.
        (method === 8 && size > compressedSize * 1032 + 1024))
    )
      issue = 'damaged'
    index.add({
      path: normalized.path,
      type: directoryEntry ? 'directory' : 'file',
      size: directoryEntry ? 0 : size,
      ...(issue ? { issue } : {}),
      offset: localOffset,
      method,
      flags,
      crc32: checksum,
      compressedSize,
    })
  }
}

/** Resolve where an entry's data begins from its local header. */
export async function zipDataOffset(
  source: ByteSource,
  index: ArchiveIndex,
  entry: { offset: number; method?: number; compressedSize?: number } & {
    dataOffset?: number
  }
) {
  if (entry.dataOffset !== undefined) return entry.dataOffset
  let header: Buffer
  try {
    header = await source.read(entry.offset, 30)
  } catch (error) {
    if (error instanceof ArchiveError) throw damagedEntry()
    throw error
  }
  if (
    header.readUInt32LE(0) !== LOCAL_HEADER ||
    header.readUInt16LE(8) !== entry.method
  )
    throw damagedEntry()
  const dataOffset =
    entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28)
  if (dataOffset + (entry.compressedSize ?? 0) > index.dataEnd)
    throw damagedEntry()
  entry.dataOffset = dataOffset
  return dataOffset
}
