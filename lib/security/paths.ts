import { basename, isAbsolute, join, normalize, resolve, sep } from 'path'

/**
 * Validates that a relative storage path is safe — no traversal sequences,
 * not absolute, and rooted under an allowed directory (uploads/ or public/).
 * Returns the normalized path. Throws on any violation.
 */
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

/**
 * Sanitizes a user-supplied filename by stripping directory components
 * and rejecting characters outside a safe set (alphanumerics, hyphens,
 * underscores, dots).  Returns the safe filename. Throws on any violation.
 */
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

/**
 * Validates that a simple identifier (e.g. an upload ID) contains only
 * lowercase alphanumeric characters so it is safe to interpolate into
 * filesystem paths.  Returns the validated segment. Throws on any violation.
 */
export function validatePathSegment(segment: string): string {
  if (!segment || !/^[a-z0-9]+$/.test(segment)) {
    throw new Error('Invalid path segment: contains disallowed characters')
  }
  return segment
}

/**
 * Joins path segments under a root directory and verifies the resolved
 * result has not escaped that root.  Returns the resolved absolute path.
 * Throws if the final path is outside `rootDir`.
 */
export function safeJoin(rootDir: string, ...segments: string[]): string {
  const root = resolve(rootDir)
  const target = resolve(join(root, ...segments))

  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error('Invalid path: escapes root directory')
  }

  return target
}
