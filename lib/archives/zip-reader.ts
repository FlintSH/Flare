import { type ArchiveIndex, normalizeBrowsePath } from './archive-index'
import { latin1, nextTurn, u64 as readU64, u16, u32 } from './bytes'
import { crc32 } from './crc32'
import { ArchiveError, damagedEntry } from './errors'
import type { RangeSource } from './range-source'
import type { ArchiveEntryIssue } from './shared'

// This reader also runs in the browser, over a decrypted file
// (docs/e2ee-spec.md, section 12.3): no Node.js imports and no `Buffer`.
type ByteSource = RangeSource

const EOCD = 0x06054b50
const ZIP64_LOCATOR = 0x07064b50
const ZIP64_EOCD = 0x06064b50
const CENTRAL_HEADER = 0x02014b50
const LOCAL_HEADER = 0x04034b50
const MAX_U32 = 0xffffffff
const YIELD_ENTRIES = 2000

/**
 * Stored and deflated members, as extraction accepts. Others (Zstandard can
 * demand a 128 MiB window per stream) are listed with a compression issue.
 */
export const PREVIEW_ZIP_METHODS = new Set([0, 8])

// IBM PC code page 437, the ZIP default when the UTF-8 flag is absent.
const CP437 =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ '
const strictUtf8 = new TextDecoder('utf-8', { fatal: true })
const lenientUtf8 = new TextDecoder('utf-8')

function damaged(message = 'This ZIP archive is damaged or incomplete.') {
  return new ArchiveError(message)
}

function u64(buffer: Uint8Array, offset: number) {
  const value = readU64(buffer, offset)
  if (value === null) throw damaged()
  return value
}

/**
 * Names without the UTF-8 flag are officially CP437, but macOS and many
 * Linux tools write UTF-8 without setting it. Prefer valid UTF-8.
 */
export function decodeZipName(raw: Uint8Array, utf8Flag: boolean) {
  if (utf8Flag) return lenientUtf8.decode(raw)
  if (raw.every((byte) => byte < 0x80)) return latin1(raw)
  try {
    return strictUtf8.decode(raw)
  } catch {
    let name = ''
    for (const byte of raw)
      name += byte < 0x80 ? String.fromCharCode(byte) : CP437[byte - 0x80]
    return name
  }
}

function extraField(extra: Uint8Array, id: number) {
  for (let offset = 0; offset + 4 <= extra.length;) {
    const header = u16(extra, offset)
    const length = u16(extra, offset + 2)
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
    if (u32(tail, index) !== EOCD) continue
    const end = index + 22 + u16(tail, index + 20)
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
  let disk = u16(tail, record + 4)
  let directoryDisk = u16(tail, record + 6)
  let entryCount = u16(tail, record + 10)
  let directorySize = u32(tail, record + 12)
  let directoryOffset = u32(tail, record + 16)
  let directoryEnd = position
  if (position >= 20) {
    const locator = await source.read(position - 20, 20)
    if (u32(locator, 0) === ZIP64_LOCATOR) {
      if (u32(locator, 16) > 1) throw splitArchive()
      const recorded = u64(locator, 8)
      // A prepended stub shifts the recorded offset; the record normally sits
      // immediately before its locator.
      const candidates = [recorded, position - 20 - 56]
      let zip64: Uint8Array | null = null
      for (const candidate of candidates) {
        if (candidate < 0 || candidate + 56 > position - 20) continue
        const bytes = await source.read(candidate, 56)
        if (u32(bytes, 0) === ZIP64_EOCD) {
          zip64 = bytes
          directoryEnd = candidate
          break
        }
      }
      if (!zip64) throw damaged()
      disk = u32(zip64, 16)
      directoryDisk = u32(zip64, 20)
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
  limits: { entries: number; directoryBytes: number; signal?: AbortSignal }
) {
  const layout = await locate(source)
  index.entryCount = layout.entryCount
  index.dataEnd = layout.directoryStart
  const readable = Math.min(layout.directorySize, limits.directoryBytes)
  const directory = await source.read(layout.directoryStart, readable)
  index.bytesRead = readable
  let offset = 0
  for (let count = 0; count < layout.entryCount; count++) {
    // Parsing runs on the main thread; let other requests in now and then.
    if (count && count % YIELD_ENTRIES === 0) {
      await nextTurn()
      limits.signal?.throwIfAborted()
    }
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
    if (u32(directory, offset) !== CENTRAL_HEADER) {
      if (!index.entries.length) throw damaged()
      index.truncated = 'damaged'
      break
    }
    const flags = u16(directory, offset + 8)
    const method = u16(directory, offset + 10)
    const checksum = u32(directory, offset + 16)
    let compressedSize = u32(directory, offset + 20)
    let size = u32(directory, offset + 24)
    const nameLength = u16(directory, offset + 28)
    const extraLength = u16(directory, offset + 30)
    const commentLength = u16(directory, offset + 32)
    const external = u32(directory, offset + 38)
    let headerOffset = u32(directory, offset + 42)
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
      u32(unicode, 1) === crc32(rawName)
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
    if (!index.hasRoomFor(normalized.path)) {
      index.truncated = 'size'
      break
    }
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
  let header: Uint8Array
  try {
    header = await source.read(entry.offset, 30)
  } catch (error) {
    if (error instanceof ArchiveError) throw damagedEntry()
    throw error
  }
  if (u32(header, 0) !== LOCAL_HEADER || u16(header, 8) !== entry.method)
    throw damagedEntry()
  const dataOffset = entry.offset + 30 + u16(header, 26) + u16(header, 28)
  if (dataOffset + (entry.compressedSize ?? 0) > index.dataEnd)
    throw damagedEntry()
  entry.dataOffset = dataOffset
  return dataOffset
}
