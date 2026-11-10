import type {
  EncryptedSource,
  StreamOptions,
} from '@/lib/e2ee/client/encrypted-source'
import {
  type PlainView,
  decodeStream,
  plainView,
} from '@/lib/e2ee/client/plain-view'
import type { LocalMember } from '@/lib/e2ee/sw/protocol'
import { LOCAL_MEDIA_TYPES } from '@/lib/files/safe-render'

import { ArchiveIndex, type IndexedEntry } from '../archive-index'
import { ArchiveError, truncatedArchive } from '../errors'
import type { RangeSource } from '../range-source'
import {
  ARCHIVE_BROWSE_LIMITS,
  ARCHIVE_ISSUE_MESSAGES,
  type ArchiveFormat,
  type ArchiveListing,
  archiveBasename,
  detectArchiveFormat,
} from '../shared'
import {
  ChunkTarInput,
  type ScanContext,
  ScanLimitReached,
  SourceTarInput,
  scanTar,
} from '../tar-reader'
import { indexZip } from '../zip-reader'

/**
 * Archive tools for an encrypted file, in the browser (docs/e2ee-spec.md,
 * section 12.3). The server holds ciphertext, so the client reads the
 * archive: it fetches and decrypts only the chunks that hold the index, and
 * then only the chunks of the entry a person opens.
 *
 * The archive is not trusted. A person who knows an account public key can
 * put any archive in a library (section 3.3, limit 2), so the entry list is
 * read by the same parsers and held to the same limits as on the server:
 * entry counts, path rules, expansion ratio, the size of the index. Each
 * entry is shown only through the renderers of the safe-render list.
 */

/** What the browser reads less of than the server does, and why. */
export const CLIENT_ARCHIVE_LIMITS = {
  /**
   * The largest ZIP central directory read. It is decrypted and parsed on
   * the page, so it is a quarter of the server's limit.
   */
  centralDirectoryBytes: 16 * 1024 ** 2,
  /** Time spent reading a TAR, TAR.GZ or GZIP to list it. */
  scanMs: ARCHIVE_BROWSE_LIMITS.scanMs,
  /**
   * Decoded bytes read while listing a TAR.GZ or GZIP. The browser has no
   * seek points in compressed data, so the listing reads all of it.
   */
  scanBytes: 4 * 1024 ** 3,
  /**
   * Decoded bytes thrown away to reach an entry in compressed data. An
   * entry deeper than this in a TAR.GZ cannot be opened on its own.
   */
  discardBytes: 256 * 1024 ** 2,
} as const

const READ_AHEAD_BYTES = 256 * 1024

/**
 * Positioned reads of the decrypted archive for the parsers. One window of
 * read-ahead: a ZIP reads its end record and directory from one place, and
 * a TAR reads many 512-byte headers that are often close together.
 */
export function rangeSource(
  source: EncryptedSource,
  signal?: AbortSignal
): RangeSource {
  let window: { start: number; bytes: Uint8Array } | null = null
  return {
    size: source.plaintextLength,
    async read(start, length) {
      signal?.throwIfAborted()
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(length) ||
        start < 0 ||
        length < 0 ||
        start + length > source.plaintextLength
      )
        throw truncatedArchive()
      if (!length) return new Uint8Array(0)
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
        source.plaintextLength - start,
        Math.max(length, READ_AHEAD_BYTES)
      )
      const bytes = await source.read(start, start + span, signal)
      window = { start, bytes }
      return bytes.subarray(0, length)
    },
  }
}

export interface ListingProgress {
  readonly index: ArchiveIndex
}

/** Reads the index of an encrypted archive. `name` and `type` are the decrypted ones. */
export async function indexEncryptedArchive(input: {
  readonly source: EncryptedSource
  readonly name: string
  readonly type?: string
  readonly signal: AbortSignal
  /** Called as entries are found, with the index so far. */
  readonly onProgress?: (index: ArchiveIndex) => void
}): Promise<ArchiveIndex> {
  const { source, signal } = input
  const format = detectArchiveFormat(input.name, input.type)
  if (!format)
    throw new ArchiveError('This archive format is not supported.', 415)
  // The end of the file first: a ZIP keeps its index there, and a listing
  // of a cut archive would be a listing of something else (section 7.4).
  await source.verifyEnd(signal)
  const index = new ArchiveIndex(format, source.plaintextLength)
  const deadline = Date.now() + CLIENT_ARCHIVE_LIMITS.scanMs
  let lastReport = 0
  const context: ScanContext = {
    signal,
    maxEntries: ARCHIVE_BROWSE_LIMITS.entries,
    tick() {
      const now = Date.now()
      if (now > deadline) throw new ScanLimitReached('time')
      if (input.onProgress && now - lastReport > 250) {
        lastReport = now
        input.onProgress(index)
      }
    },
  }
  const bytes = rangeSource(source, signal)
  if (format === 'zip')
    await indexZip(bytes, index, {
      entries: ARCHIVE_BROWSE_LIMITS.entries,
      directoryBytes: CLIENT_ARCHIVE_LIMITS.centralDirectoryBytes,
      signal,
    })
  else if (format === 'tar')
    await scanTar(new SourceTarInput(bytes, index), index, context)
  else {
    if (!source.plaintextLength)
      throw new ArchiveError('This compressed file is empty or incomplete.')
    await scanCompressed(source, index, format, input.name, context)
  }
  signal.throwIfAborted()
  index.complete = true
  return index
}

async function scanCompressed(
  source: EncryptedSource,
  index: ArchiveIndex,
  format: 'tar.gz' | 'gzip',
  name: string,
  context: ScanContext
) {
  let decoded = 0
  async function* counted() {
    let consumed = 0
    for await (const piece of source.stream(0, source.plaintextLength, {
      window: 'whole',
      signal: context.signal,
    })) {
      consumed += piece.length
      index.bytesRead = consumed
      yield piece
    }
  }
  async function* limited() {
    try {
      for await (const piece of decodeStream(counted(), 'gzip')) {
        decoded += piece.length
        context.signal.throwIfAborted()
        context.tick()
        if (decoded > CLIENT_ARCHIVE_LIMITS.scanBytes)
          throw new ScanLimitReached('size')
        yield piece
      }
    } catch (error) {
      // The browser's decoder reports bad data without saying what is wrong.
      if (error instanceof Error && error.name === 'DamagedEntry')
        throw new ArchiveError(
          'This GZIP data is damaged, or it has several parts. Flare reads GZIP files with one part in the browser.'
        )
      throw error
    }
  }
  if (format === 'tar.gz') {
    const input = new ChunkTarInput(limited())
    try {
      await scanTar(input, index, context)
    } finally {
      await input.close()
    }
    return
  }
  // A GZIP holds one file; its name follows the archive, as on extraction.
  let size = 0
  let issue: 'damaged' | 'incomplete' | undefined
  try {
    for await (const piece of limited()) size += piece.length
  } catch (error) {
    if (error instanceof ScanLimitReached) {
      index.truncated = error.reason
      issue = 'incomplete'
    } else if (
      error instanceof ArchiveError &&
      size &&
      !context.signal.aborted
    ) {
      index.truncated = 'damaged'
      issue = 'damaged'
    } else throw error
  }
  index.add({
    path: archiveBasename(name),
    type: 'file',
    size,
    ...(issue ? { issue } : {}),
    offset: 0,
  })
}

/** Where the bytes of an entry are in the decrypted archive. */
export function entryMember(
  index: ArchiveIndex,
  entry: IndexedEntry
): LocalMember {
  if (entry.type !== 'file' || entry.issue)
    throw new ArchiveError(
      entry.issue
        ? ARCHIVE_ISSUE_MESSAGES[entry.issue]
        : 'Choose a file in the archive.',
      415
    )
  if (index.format === 'tar')
    return { kind: 'stored', offset: entry.offset, length: entry.size }
  if (index.format !== 'zip')
    return { kind: 'gzip', offset: entry.offset, length: entry.size }
  return {
    kind: 'zip',
    headerOffset: entry.offset,
    method: entry.method ?? -1,
    compressedLength: entry.compressedSize ?? 0,
    length: entry.size,
    crc32: entry.crc32,
    dataEnd: index.dataEnd,
  }
}

/** Whether an entry can be opened on its own, or is too deep in compressed data. */
export function entryReachable(view: PlainView): boolean {
  return view.discardedBefore(0) <= CLIENT_ARCHIVE_LIMITS.discardBytes
}

const ENTRY_MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
}

/**
 * The fixed media type an entry is shown with, from its extension, or null
 * for an entry that is not shown as media. The type is never taken from the
 * archive, and it is always one of the types a local address serves: no
 * HTML, no SVG. Bytes that are not that kind of media do not display.
 */
export function entryMediaType(path: string): string | null {
  const name = path.split('/').at(-1)?.toLowerCase() ?? ''
  const extension = name.includes('.') ? name.split('.').at(-1)! : ''
  const type = ENTRY_MEDIA_TYPES[extension]
  return type && LOCAL_MEDIA_TYPES.has(type) ? type : null
}

/** An opened encrypted archive: its index, and how to read its entries. */
export class EncryptedArchive {
  constructor(
    readonly source: EncryptedSource,
    readonly index: ArchiveIndex
  ) {}

  get format(): ArchiveFormat {
    return this.index.format
  }

  listing(): ArchiveListing {
    return this.index.listing()
  }

  /** The listed entry at `position`, as the browse listing numbers them. */
  entry(position: number): IndexedEntry {
    const entry = this.index.entries[position]
    if (!entry) throw new ArchiveError('Choose a valid archive entry.', 400)
    return entry
  }

  member(position: number): LocalMember {
    return entryMember(this.index, this.entry(position))
  }

  async view(position: number): Promise<PlainView> {
    const view = plainView(this.source, this.member(position))
    if (!entryReachable(view))
      throw new ArchiveError(
        'This file is too far into a compressed archive to open on its own in the browser. Download the whole archive to open it.',
        413
      )
    return view
  }

  /** The bytes `[start, end)` of an entry, in memory. For previews. */
  async read(
    position: number,
    start: number,
    end: number,
    signal?: AbortSignal
  ): Promise<Uint8Array> {
    const view = await this.view(position)
    const last = Math.min(end, view.length)
    const out = new Uint8Array(Math.max(0, last - start))
    let written = 0
    for await (const piece of view.stream(start, last, { signal })) {
      out.set(piece, written)
      written += piece.length
    }
    return out
  }

  /** The whole entry as a stream of verified, decoded pieces. */
  async stream(
    position: number,
    options?: StreamOptions
  ): Promise<AsyncGenerator<Uint8Array, void, undefined>> {
    const view = await this.view(position)
    return view.stream(0, view.length, options)
  }
}
