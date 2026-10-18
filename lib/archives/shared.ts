/** Browser-safe archive capabilities. The server always validates the bytes. */
// Extraction and creation stage whole archives; ARCHIVE_LIMITS bounds that work.
export type ArchiveFormat = 'zip' | 'tar' | 'tar.gz' | 'gzip'
export type ArchiveOutputFormat = 'zip' | 'tar.gz'

export const ARCHIVE_LIMITS = {
  archiveBytes: 256 * 1024 ** 2,
  expandedBytes: 512 * 1024 ** 2,
  fileBytes: 256 * 1024 ** 2,
  entries: 1000,
  selectedFiles: 100,
  pathDepth: 20,
  pathLength: 1024,
  timeoutMs: 120_000,
} as const

/**
 * Browsing reads only the archive index and the selected entry, so these limits
 * are much larger than the extraction limits above.
 */
export const ARCHIVE_BROWSE_LIMITS = {
  /** Entries listed for one archive; larger archives show the first ones. */
  entries: 100_000,
  /** Largest ZIP central directory read while listing. */
  centralDirectoryBytes: 64 * 1024 ** 2,
  /** Time spent reading a TAR, TAR.GZ, or GZIP to list its contents. */
  scanMs: 120_000,
  /** Uncompressed bytes read while listing one TAR.GZ or GZIP. */
  scanBytes: 64 * 1024 ** 3,
  /**
   * Decoded bytes Flare discards to reach a position in compressed data. A
   * deeper byte range gets the whole file instead; a deeper file can't open.
   */
  discardBytes: 1024 ** 3,
  /** Longest entry path served; longer listed names are shortened and flagged. */
  pathLength: 4096,
  textPreviewBytes: 256 * 1024,
  imagePreviewBytes: 50 * 1024 ** 2,
} as const

/** Why an entry can be listed but not previewed or extracted. */
export type ArchiveEntryIssue =
  | 'encrypted'
  | 'compression'
  | 'link'
  | 'special'
  | 'unsafe-path'
  | 'sparse'
  | 'damaged'
  | 'incomplete'

/** Shown in previews and returned when an entry with an issue is requested. */
export const ARCHIVE_ISSUE_MESSAGES: Record<ArchiveEntryIssue, string> = {
  encrypted:
    'This file is encrypted inside the archive. Download the whole archive and open it with its password.',
  compression:
    'This file uses a compression method Flare can’t read. Download the whole archive to open it.',
  link: 'This entry is a link to another path, so it has no contents to show.',
  special:
    'This entry is a special filesystem object, not a regular file, so it has no contents to show.',
  'unsafe-path':
    'This entry’s path is unsafe, so Flare won’t open it. Download the whole archive to inspect it locally.',
  sparse:
    'This file is stored as a sparse TAR file, which Flare can’t read. Download the whole archive to open it.',
  damaged: 'This file’s data in the archive is damaged, so it can’t be read.',
  incomplete:
    'Flare stopped reading the archive before the end of this file, so its size isn’t known and it can’t be opened here. Download the whole archive to open it.',
}

export interface ArchiveEntry {
  path: string
  type: 'file' | 'directory'
  /** Uncompressed bytes; directories always use zero. */
  size: number
  /** Present when browsing found a problem with this entry. */
  issue?: ArchiveEntryIssue
  /** Internal staging path; never include this field in API responses. */
  diskPath?: string
}

export interface ArchiveManifest {
  format: ArchiveFormat
  entries: ArchiveEntry[]
  fileCount: number
  totalBytes: number
}

/** Why a listing stops before the end of the archive. */
export type ArchiveTruncation = 'entries' | 'time' | 'size' | 'damaged'

export type ArchiveExtraction =
  { available: true } | { available: false; reason: string }

/** Browse response: a manifest plus what Flare could read and extract. */
export interface ArchiveListing extends ArchiveManifest {
  /** Compressed archive size in bytes. */
  archiveBytes: number
  /** Entries the archive declares; can exceed `entries.length` when truncated. */
  entryCount: number
  truncated: ArchiveTruncation | null
  extraction: ArchiveExtraction
}

/** Returned with HTTP 202 while a TAR, TAR.GZ, or GZIP is still being read. */
export interface ArchiveListingProgress {
  status: 'indexing'
  format: ArchiveFormat
  archiveBytes: number
  bytesRead: number
  /** Entries found after the requested `after` cursor. */
  entries: ArchiveEntry[]
  entriesFound: number
}

export function detectArchiveFormat(
  name: string,
  mimeType?: string
): ArchiveFormat | null {
  const lower = name.toLowerCase()
  if (/\.(tar\.gz|tgz)$/.test(lower)) return 'tar.gz'
  if (/\.zip$/.test(lower)) return 'zip'
  if (/\.tar$/.test(lower)) return 'tar'
  if (/\.gz$/.test(lower)) return 'gzip'
  if (
    [
      'application/zip',
      'application/x-zip-compressed',
      'application/x-zip',
      'multipart/x-zip',
    ].includes(mimeType ?? '')
  )
    return 'zip'
  if (
    ['application/x-tar', 'application/tar', 'application/x-gtar'].includes(
      mimeType ?? ''
    )
  )
    return 'tar'
  if (
    ['application/gzip', 'application/x-gzip', 'application/x-gunzip'].includes(
      mimeType ?? ''
    )
  )
    return 'gzip'
  return null
}

export const getArchiveFormat = detectArchiveFormat

export function archiveBasename(name: string): string {
  return name.replace(/\.(tar\.gz|tgz|zip|tar|gz)$/i, '') || 'Archive'
}
