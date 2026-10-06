/** Browser-safe archive capabilities. The server always validates the bytes. */
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

export interface ArchiveEntry {
  path: string
  type: 'file' | 'directory'
  /** Uncompressed bytes; directories always use zero. */
  size: number
  /** Internal staging path; never include this field in API responses. */
  diskPath?: string
}

export interface ArchiveManifest {
  format: ArchiveFormat
  entries: ArchiveEntry[]
  fileCount: number
  totalBytes: number
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
