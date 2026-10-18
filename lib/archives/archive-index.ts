import { formatBytes } from '@/lib/utils'

import { ManifestBuilder } from './codec'
import { ArchiveError } from './errors'
import type { GzipSeekIndex } from './gzip-reader'
import {
  ARCHIVE_BROWSE_LIMITS,
  ARCHIVE_LIMITS,
  type ArchiveEntry,
  type ArchiveEntryIssue,
  type ArchiveExtraction,
  type ArchiveFormat,
  type ArchiveListing,
  type ArchiveListingProgress,
  type ArchiveTruncation,
} from './shared'

/** One listed member plus the internal coordinates needed to read it later. */
export interface IndexedEntry extends Omit<ArchiveEntry, 'diskPath'> {
  /** ZIP: local header offset. TAR: data offset in the uncompressed TAR stream. */
  offset: number
  /** ZIP only. */
  method?: number
  flags?: number
  crc32?: number
  compressedSize?: number
  /** ZIP data offset, resolved from the local header on first read. */
  dataOffset?: number
  /** Inline media type detected from the entry's own bytes; null when none. */
  mediaType?: string | null
}

/**
 * Largest estimated in-memory size of one listing, half of the listing cache,
 * so a finished listing always fits. Listings stop with `truncated: 'size'`.
 */
export const ARCHIVE_INDEX_MAX_BYTES = 64 * 1024 ** 2

/**
 * Estimated memory for one listed entry: the entry object, plus its share of
 * the finished listing's encoded JSON, which is kept for repeat visits.
 */
function entryCost(path: string) {
  return 240 + 5 * path.length
}

export class ArchiveIndex {
  readonly entries: IndexedEntry[] = []
  private readonly files = new Map<string, number>()
  private extraction: ArchiveExtraction | null = null
  private encoded: Blob | null = null
  private entryBytes = 0
  fileCount = 0
  totalBytes = 0
  /** Entries the archive declares; ZIP knows this before every entry is read. */
  entryCount: number | null = null
  truncated: ArchiveTruncation | null = null
  complete = false
  /** Bytes of the compressed source consumed while indexing. */
  bytesRead = 0
  /** ZIP central directory start; entry data must end before it. */
  dataEnd: number
  /** TAR written without a ustar or GNU signature, which extraction rejects. */
  legacyTar = false
  gzip: GzipSeekIndex | null = null

  constructor(
    readonly format: ArchiveFormat,
    readonly archiveBytes: number,
    readonly maxBytes = ARCHIVE_INDEX_MAX_BYTES
  ) {
    this.dataEnd = archiveBytes
  }

  /** Whether an entry with this path still fits the listing's memory budget. */
  hasRoomFor(path: string) {
    return this.memoryBytes + entryCost(path) <= this.maxBytes
  }

  add(entry: IndexedEntry) {
    this.entries.push(entry)
    this.entryBytes += entryCost(entry.path)
    if (entry.type !== 'file') return
    // Like common unzip tools, a repeated path refers to its last copy.
    const previous = this.files.get(entry.path)
    if (previous === undefined) this.fileCount++
    else this.totalBytes -= this.entries[previous].size
    this.files.set(entry.path, this.entries.length - 1)
    this.totalBytes += entry.size
  }

  find(path: string) {
    const position = this.files.get(path)
    return position === undefined ? undefined : this.entries[position]
  }

  get memoryBytes() {
    return 2048 + (this.gzip?.memoryBytes ?? 0) + this.entryBytes
  }

  private publicEntries(after: number): ArchiveEntry[] {
    return this.entries
      .slice(after)
      .map(({ path, type, size, issue }) =>
        issue ? { path, type, size, issue } : { path, type, size }
      )
  }

  listing(after = 0): ArchiveListing {
    if (this.complete) this.extraction ??= assessExtraction(this)
    return {
      format: this.format,
      entries: this.publicEntries(after),
      fileCount: this.fileCount,
      totalBytes: this.totalBytes,
      archiveBytes: this.archiveBytes,
      entryCount: Math.max(this.entryCount ?? 0, this.entries.length),
      truncated: this.truncated,
      extraction: this.extraction ?? assessExtraction(this),
    }
  }

  /**
   * The complete listing as JSON, encoded once. Repeat visits to a large
   * archive then cost no serialization work.
   */
  listingJson() {
    if (!this.complete) throw new Error('The archive listing is incomplete.')
    this.encoded ??= new Blob([JSON.stringify(this.listing())])
    return this.encoded
  }

  progress(after = 0): ArchiveListingProgress {
    return {
      status: 'indexing',
      format: this.format,
      archiveBytes: this.archiveBytes,
      bytesRead: Math.min(this.bytesRead, this.archiveBytes),
      entries: this.publicEntries(after),
      entriesFound: this.entries.length,
    }
  }
}

/**
 * Display paths are relative and slash-separated. Paths that escape the
 * archive stay visible, so a listing is never silently partial, but they are
 * flagged and never served. Control and formatting characters (which can
 * disguise a name) are shown as U+FFFD; the extraction check rejects them.
 */
export function normalizeBrowsePath(raw: string): {
  path: string
  unsafe: boolean
} {
  let value = raw.replace(/[\p{Cc}\p{Cf}]/gu, '\uFFFD')
  let unsafe = false
  if (value.includes('\\')) {
    unsafe = true
    value = value.replace(/\\/g, '/')
  }
  if (/^[a-z]:/i.test(value)) {
    unsafe = true
    value = value.slice(2)
  }
  if (value.startsWith('/')) {
    unsafe = true
    value = value.replace(/^\/+/, '')
  }
  while (value.startsWith('./')) value = value.slice(2)
  // One trailing slash marks a directory; anything else is an empty segment.
  value = value.replace(/\/$/, '')
  const parts: string[] = []
  for (const part of value.split('/')) {
    if (!part || part === '.') {
      if (value) unsafe = true
      continue
    }
    if (part === '..') unsafe = true
    parts.push(part)
  }
  let path = parts.join('/')
  if (path.length > ARCHIVE_BROWSE_LIMITS.pathLength) {
    unsafe = true
    path = path.slice(0, ARCHIVE_BROWSE_LIMITS.pathLength)
  }
  return { path, unsafe }
}

const ISSUE_REASONS: Record<ArchiveEntryIssue, string> = {
  encrypted: 'it contains encrypted files',
  compression: 'it uses a compression method Flare can’t extract',
  link: 'it contains links',
  special: 'it contains special filesystem entries',
  'unsafe-path': 'it contains unsafe paths',
  sparse: 'it contains sparse files',
  damaged: 'part of it is damaged',
  incomplete: 'Flare couldn’t read the whole archive',
}

/** The strict extractor accepts only stored and deflated ZIP members. */
const EXTRACTABLE_ZIP_METHODS = new Set([0, 8])

function unavailable(reason: string): ArchiveExtraction {
  return {
    available: false,
    reason: `Extract all isn’t available because ${reason}. You can still preview and download individual files.`,
  }
}

function builderReason(message: string) {
  if (/at most 1,000/.test(message))
    return `it has more than ${ARCHIVE_LIMITS.entries.toLocaleString('en-US')} files and folders`
  if (/duplicate or conflicting/.test(message))
    return 'it contains duplicate or conflicting file and folder names'
  if (/levels deep/.test(message))
    return `it has paths more than ${ARCHIVE_LIMITS.pathDepth} levels deep`
  if (/folder name/.test(message))
    return 'a folder name is longer than 80 characters or uses characters Flare folders don’t allow'
  if (/filename/.test(message))
    return 'a filename is longer than 255 characters or uses unsafe characters'
  if (/long path/.test(message))
    return `it has a path that is unsafe or longer than ${ARCHIVE_LIMITS.pathLength.toLocaleString('en-US')} characters`
  return message.charAt(0).toLowerCase() + message.slice(1).replace(/\.$/, '')
}

/** Explain before a request what the strict extractor would reject. */
export function assessExtraction(index: ArchiveIndex): ArchiveExtraction {
  if (!index.complete) return unavailable('Flare is still reading the archive')
  if (index.truncated)
    return unavailable('Flare couldn’t read the whole archive')
  if (index.archiveBytes > ARCHIVE_LIMITS.archiveBytes)
    return unavailable(
      `it is ${formatBytes(index.archiveBytes)}, larger than the ${formatBytes(ARCHIVE_LIMITS.archiveBytes)} extraction limit`
    )
  if (index.legacyTar)
    return unavailable('it uses an older TAR format Flare can’t extract')
  let largest: IndexedEntry | null = null
  for (const entry of index.entries) {
    const issue =
      entry.issue ??
      (entry.type === 'file' &&
      entry.method !== undefined &&
      !EXTRACTABLE_ZIP_METHODS.has(entry.method)
        ? 'compression'
        : undefined)
    if (issue) return unavailable(ISSUE_REASONS[issue])
    if (entry.type === 'file' && entry.size > (largest?.size ?? -1))
      largest = entry
  }
  if (largest && largest.size > ARCHIVE_LIMITS.fileBytes)
    return unavailable(
      `${largest.path} is ${formatBytes(largest.size)}, larger than the ${formatBytes(ARCHIVE_LIMITS.fileBytes)} limit for one file`
    )
  if (index.totalBytes > ARCHIVE_LIMITS.expandedBytes)
    return unavailable(
      `it unpacks to ${formatBytes(index.totalBytes)}, more than the ${formatBytes(ARCHIVE_LIMITS.expandedBytes)} extraction limit`
    )
  // The extractor's own path, count, and collision rules decide the rest.
  const builder = new ManifestBuilder()
  try {
    for (const entry of index.entries)
      builder.add(entry.path, entry.type, entry.size)
  } catch (error) {
    if (error instanceof ArchiveError)
      return unavailable(builderReason(error.message))
    throw error
  }
  return { available: true }
}
