import { TAG_NAME_MAX_LENGTH } from '@/types/dto/tag'

/**
 * Normalizes a raw tag name: trims, collapses internal whitespace, and clamps to
 * the maximum length. The display casing is preserved.
 */
export function normalizeTagName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, TAG_NAME_MAX_LENGTH)
}

/**
 * Case-insensitive equality for tag names, used to detect duplicates while still
 * letting users pick their preferred display casing.
 */
export function tagNamesEqual(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0
}
