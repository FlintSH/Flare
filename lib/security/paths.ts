import { basename, isAbsolute, join, normalize, resolve, sep } from 'path'

// safe for Content-Disposition headers and zip entry names
export function sanitizeDisplayName(name: string): string {
  const cleaned = name.replace(/[\x00-\x1f\x7f]/g, '').replace(/\.\./g, '')
  return basename(cleaned) || 'download'
}

export function validateStoragePath(path: string): string {
  const normalizedPath = normalize(path).replace(/\\/g, '/')

  if (isAbsolute(normalizedPath) || normalizedPath.includes('..')) {
    throw new Error('Invalid storage path: Path traversal detected')
  }

  if (
    !normalizedPath.startsWith('uploads/') &&
    !normalizedPath.startsWith('public/')
  ) {
    throw new Error(
      'Invalid storage path: Path must be within allowed directories'
    )
  }

  return normalizedPath
}

export function sanitizeFilename(filename: string): string {
  const safe = basename(filename)
  if (!safe || safe !== filename) {
    throw new Error('Invalid filename: contains path components')
  }
  if (!/^[\w\-.]+$/.test(safe)) {
    throw new Error('Invalid filename: contains disallowed characters')
  }
  return safe
}

export function validatePathSegment(segment: string): string {
  if (!segment || !/^[a-z0-9]+$/.test(segment)) {
    throw new Error('Invalid path segment: contains disallowed characters')
  }
  return segment
}

export function safeJoin(rootDir: string, ...segments: string[]): string {
  const root = resolve(rootDir)
  const target = resolve(join(root, ...segments))

  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error('Invalid path: escapes root directory')
  }

  return target
}
