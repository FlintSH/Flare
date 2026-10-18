import { type ArchiveIndex, normalizeBrowsePath } from './archive-index'
import { type ByteSource, truncatedArchive } from './byte-source'
import { ArchiveError } from './errors'
import type { ArchiveEntryIssue } from './shared'

/** Sequential TAR input that can jump over member data. */
export interface TarInput {
  readonly position: number
  /** Exactly `length` bytes, or null at a clean end of input. */
  read(length: number): Promise<Buffer | null>
  skip(length: number): Promise<void>
}

/** Thrown by a scan budget; the listing keeps the entries found so far. */
export class ScanLimitReached extends Error {
  constructor(readonly reason: 'time' | 'size') {
    super(`Archive scan stopped: ${reason}`)
  }
}

export interface ScanContext {
  signal: AbortSignal
  /** Throws {@link ScanLimitReached} when the listing budget is spent. */
  tick(): void
  maxEntries: number
}

const USTAR = Buffer.from('ustar\0', 'latin1')
const GNU = Buffer.from('ustar ', 'latin1')
// Long names and PAX records are small; larger ones are hostile or damaged.
const MAX_METADATA = 1024 * 1024

function damaged(message = 'This TAR archive is damaged or incomplete.') {
  return new ArchiveError(message)
}

function text(block: Buffer, start: number, length: number) {
  const end = block.indexOf(0, start)
  return block.toString(
    'utf8',
    start,
    end < 0 || end > start + length ? start + length : end
  )
}

/** Octal ASCII, or GNU base-256 for values that do not fit. */
export function tarNumber(block: Buffer, start: number, length: number) {
  const field = block.subarray(start, start + length)
  if (field[0] & 0x80) {
    if (field[0] !== 0x80) return null
    let value = 0
    for (let index = 1; index < field.length; index++)
      value = value * 256 + field[index]
    return Number.isSafeInteger(value) ? value : null
  }
  // Like tar-stream: skip leading spaces and NULs, stop at a space or NUL.
  let first = 0
  while (field[first] === 0x20) first++
  while (field[first] === 0) first++
  let last = first
  while (last < field.length && field[last] !== 0x20 && field[last] !== 0)
    last++
  const digits = field.toString('latin1', first, last)
  if (!digits) return 0
  if (!/^[0-7]+$/.test(digits)) return null
  const value = parseInt(digits, 8)
  return Number.isSafeInteger(value) ? value : null
}

function checksumValid(block: Buffer) {
  const expected = tarNumber(block, 148, 8)
  if (expected === null) return false
  let unsigned = 8 * 32
  let signed = 8 * 32
  for (let index = 0; index < 512; index++) {
    if (index >= 148 && index < 156) continue
    unsigned += block[index]
    signed += block[index] > 127 ? block[index] - 256 : block[index]
  }
  return expected === unsigned || expected === signed
}

function paxRecords(data: Buffer) {
  const records: Record<string, string> = {}
  let offset = 0
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset)
    if (space < 0) break
    const length = Number(data.toString('latin1', offset, space))
    if (!Number.isSafeInteger(length) || length <= 0) break
    const record = data.toString('utf8', space + 1, offset + length - 1)
    const equals = record.indexOf('=')
    if (equals > 0) records[record.slice(0, equals)] = record.slice(equals + 1)
    offset += length
  }
  return records
}

const padded = (size: number) => size + ((512 - (size % 512)) % 512)

/** List TAR members without reading their data. */
export async function scanTar(
  input: TarInput,
  index: ArchiveIndex,
  context: ScanContext
) {
  let pax: Record<string, string> = {}
  let longName: string | null = null
  let ended = false
  let current: { entry: { issue?: ArchiveEntryIssue } } | null = null
  try {
    while (true) {
      context.signal.throwIfAborted()
      context.tick()
      const block = await input.read(512)
      if (!block) break
      if (block.every((byte) => byte === 0)) {
        ended = true
        break
      }
      if (!checksumValid(block)) {
        if (!index.entries.length)
          throw damaged(
            'This file isn’t a readable TAR archive. It may be damaged or use a different format.'
          )
        index.truncated = 'damaged'
        return
      }
      const typeflag = String.fromCharCode(block[156] || 0x30)
      let size = tarNumber(block, 124, 12)
      if (size === null || size < 0) throw damaged()
      const magic = block.subarray(257, 263)
      const ustar = magic.equals(USTAR)
      if (!ustar && !magic.equals(GNU)) index.legacyTar = true
      if (typeflag === 'x' || typeflag === 'g') {
        if (size > MAX_METADATA) throw damaged()
        const data = await input.read(padded(size))
        if (!data) throw truncatedArchive()
        // Like tar-stream, each extended header replaces the previous one, so
        // a chain of headers can't accumulate. Global headers are ignored.
        if (typeflag === 'x') pax = paxRecords(data.subarray(0, size))
        continue
      }
      if (typeflag === 'L' || typeflag === 'K' || typeflag === 'N') {
        if (size > MAX_METADATA) throw damaged()
        const data = await input.read(padded(size))
        if (!data) throw truncatedArchive()
        if (typeflag !== 'K') longName = text(data, 0, size)
        continue
      }
      let name = text(block, 0, 100)
      if (ustar && block[345]) name = `${text(block, 345, 155)}/${name}`
      name = pax.path ?? longName ?? name
      if (pax.size !== undefined) {
        const declared = Number(pax.size)
        if (!Number.isSafeInteger(declared) || declared < 0) throw damaged()
        size = declared
      }
      const sparse =
        typeflag === 'S' || Object.keys(pax).some((key) => /sparse/i.test(key))
      pax = {}
      longName = null
      let type: 'file' | 'directory' = 'file'
      let issue: ArchiveEntryIssue | undefined
      // Old TARs mark directories only with a trailing slash.
      if (typeflag === '5' || (typeflag === '0' && name.endsWith('/')))
        type = 'directory'
      else if (typeflag === '1' || typeflag === '2') issue = 'link'
      else if (sparse) issue = 'sparse'
      else if (!['0', '7'].includes(typeflag)) issue = 'special'
      // Directory data is never read, matching the strict extractor.
      const dataLength = type === 'directory' ? 0 : size
      const normalized = normalizeBrowsePath(name)
      if (normalized.unsafe) issue ??= 'unsafe-path'
      if (normalized.path) {
        if (index.entries.length >= context.maxEntries) {
          index.truncated = 'entries'
          return
        }
        if (!index.hasRoomFor(normalized.path)) {
          index.truncated = 'size'
          return
        }
        const entry = {
          path: normalized.path,
          type,
          size: type === 'directory' ? 0 : size,
          ...(issue ? { issue } : {}),
          offset: input.position,
        }
        index.add(entry)
        current = { entry }
      }
      await input.skip(padded(dataLength))
      current = null
    }
    // A cleanly ended stream without the zero-block end marker may be cut short.
    if (!ended && index.entries.length) index.truncated = 'damaged'
  } catch (error) {
    if (error instanceof ScanLimitReached) {
      index.truncated = error.reason
      return
    }
    if (
      error instanceof ArchiveError &&
      !context.signal.aborted &&
      index.entries.length
    ) {
      if (current) current.entry.issue = 'damaged'
      index.truncated = 'damaged'
      return
    }
    throw error
  }
}

/** TAR input over random-access storage: skipping member data costs nothing. */
export class SourceTarInput implements TarInput {
  position = 0

  constructor(
    private readonly source: ByteSource,
    private readonly index: ArchiveIndex
  ) {}

  async read(length: number) {
    if (this.position >= this.source.size) return null
    if (this.position + length > this.source.size) throw truncatedArchive()
    const bytes = await this.source.read(this.position, length)
    this.position += length
    this.index.bytesRead = this.position
    return bytes
  }

  async skip(length: number) {
    this.position += length
    if (this.position > this.source.size) throw truncatedArchive()
    this.index.bytesRead = this.position
  }
}

/** TAR input over decompressed chunks; skipping still has to decompress. */
export class ChunkTarInput implements TarInput {
  position = 0
  private chunks: Buffer[] = []
  private buffered = 0
  private finished = false

  constructor(private readonly chunksIn: AsyncIterator<Buffer>) {}

  private async fill(length: number) {
    while (this.buffered < length && !this.finished) {
      const next = await this.chunksIn.next()
      if (next.done) this.finished = true
      else if (next.value.length) {
        this.chunks.push(next.value)
        this.buffered += next.value.length
      }
    }
  }

  async read(length: number) {
    await this.fill(length)
    if (!this.buffered && this.finished) return null
    if (this.buffered < length) throw truncatedArchive()
    const parts: Buffer[] = []
    let needed = length
    while (needed) {
      const chunk = this.chunks[0]
      if (chunk.length <= needed) {
        parts.push(chunk)
        this.chunks.shift()
        needed -= chunk.length
      } else {
        parts.push(chunk.subarray(0, needed))
        this.chunks[0] = chunk.subarray(needed)
        needed = 0
      }
    }
    this.buffered -= length
    this.position += length
    return parts.length === 1 ? parts[0] : Buffer.concat(parts, length)
  }

  async skip(length: number) {
    let remaining = length
    while (remaining) {
      if (!this.buffered) {
        await this.fill(1)
        if (!this.buffered) throw truncatedArchive()
      }
      const chunk = this.chunks[0]
      const take = Math.min(remaining, chunk.length)
      if (take === chunk.length) this.chunks.shift()
      else this.chunks[0] = chunk.subarray(take)
      this.buffered -= take
      this.position += take
      remaining -= take
    }
  }

  async close() {
    await this.chunksIn.return?.()
  }
}
