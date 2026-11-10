import { FOLDER_NAME_MAX_LENGTH, folderNameSchema } from '@/lib/folders/schema'

import { ArchiveError } from './errors'
import { ARCHIVE_LIMITS, type ArchiveEntry } from './shared'

/**
 * The path, count and size rules of extraction and creation. The server
 * applies them to plain archives and the browser to encrypted ones
 * (docs/e2ee-spec.md, section 12.3), so this module has no Node.js imports.
 */

/** Reject aliasing paths before any account file or directory is created. */
export function validateArchivePath(raw: string, directory = false): string {
  if (
    !raw ||
    raw.length > ARCHIVE_LIMITS.pathLength ||
    /[\\:\p{Cc}\p{Cf}\uFFFD]/u.test(raw) ||
    raw.startsWith('/')
  )
    throw new ArchiveError(
      'The archive contains an unsafe or excessively long path.'
    )
  let path = raw
  while (path.startsWith('./')) path = path.slice(2)
  if (directory) path = path.replace(/\/$/, '')
  if (!path && directory) return '' // A conventional TAR root entry (./).
  const parts = path.split('/')
  if (
    parts.length > ARCHIVE_LIMITS.pathDepth ||
    parts.some((part) => !part || part === '.' || part === '..')
  )
    throw new ArchiveError(
      'Archive paths must be relative and at most 20 levels deep.'
    )
  const normalized = parts.map((part, index) => {
    if (directory || index < parts.length - 1) {
      const parsed = folderNameSchema.safeParse(part)
      if (!parsed.success)
        throw new ArchiveError(
          `An archive folder name does not fit Flare’s folder rules (${FOLDER_NAME_MAX_LENGTH} characters, no controls or slashes).`
        )
      return parsed.data
    }
    const value = part.normalize('NFKC')
    if (
      value.length > 255 ||
      !value.trim() ||
      value === '.' ||
      value === '..' ||
      /[\\/:\p{Cc}\p{Cf}]/u.test(value)
    )
      throw new ArchiveError(
        'An archive filename is unsafe or longer than 255 characters.'
      )
    return value
  })
  return normalized.join('/')
}

/** Also tracks inferred directories, so file/directory and case collisions fail. */
export class ManifestBuilder {
  entries: ArchiveEntry[] = []
  totalBytes = 0
  fileCount = 0
  count = 0
  nodes = new Map<
    string,
    {
      path: string
      sourcePath: string
      type: ArchiveEntry['type']
      explicit: boolean
    }
  >()

  add(
    raw: string,
    type: ArchiveEntry['type'],
    size: number
  ): ArchiveEntry | null {
    if (++this.count > ARCHIVE_LIMITS.entries)
      throw new ArchiveError('Archives can contain at most 1,000 entries.', 413)
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      (type === 'directory' && size !== 0)
    )
      throw new ArchiveError('The archive contains an invalid entry size.')
    if (size > ARCHIVE_LIMITS.fileBytes)
      throw new ArchiveError('An archive member exceeds 256 MiB.', 413)
    const path = validateArchivePath(raw, type === 'directory')
    if (!path) return null
    const parts = path.split('/')
    const sourceParts = raw
      .replace(/^(\.\/)+/, '')
      .replace(/\/$/, '')
      .split('/')
    for (let index = 0; index < parts.length; index++) {
      const nodePath = parts.slice(0, index + 1).join('/')
      const last = index === parts.length - 1
      const nodeType = last ? type : 'directory'
      const sourcePath = sourceParts.slice(0, index + 1).join('/')
      const key = nodePath.toLowerCase()
      const existing = this.nodes.get(key)
      if (
        existing &&
        (existing.path !== nodePath ||
          existing.sourcePath !== sourcePath ||
          existing.type !== nodeType ||
          (last && existing.explicit))
      )
        throw new ArchiveError(
          'The archive contains duplicate or conflicting file and folder names.'
        )
      this.nodes.set(key, {
        path: nodePath,
        sourcePath,
        type: nodeType,
        explicit: last || existing?.explicit || false,
      })
      if (this.nodes.size > ARCHIVE_LIMITS.entries)
        throw new ArchiveError(
          'Archives can contain at most 1,000 files and folders, including parent folders.',
          413
        )
    }
    this.totalBytes += size
    if (this.totalBytes > ARCHIVE_LIMITS.expandedBytes)
      throw new ArchiveError('Expanded archive contents exceed 512 MiB.', 413)
    if (type === 'file') this.fileCount++
    const entry = { path, type, size }
    this.entries.push(entry)
    return entry
  }
}
