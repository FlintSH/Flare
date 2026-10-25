import { nanoid } from 'nanoid'

// The part after the last dot is an extension only when it looks like one.
// Anything else, such as `notes 2026.10.25 final`, stays part of the name.
const EXTENSION = /^[A-Za-z0-9]{1,16}$/

function splitExtension(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf('.')
  const candidate = dot > 0 ? name.slice(dot + 1) : ''
  return EXTENSION.test(candidate)
    ? { stem: name.slice(0, dot), extension: candidate.toLowerCase() }
    : { stem: name, extension: '' }
}

function withExtension(base: string, extension: string): string {
  return extension ? `${base}.${extension}` : base
}

export function generateRandomFileName(originalName: string): string {
  return withExtension(nanoid(6), splitExtension(originalName).extension)
}

/**
 * The filename part of a new file's URL: lowercase ASCII letters, digits and
 * hyphens, plus a recognized extension. A name with no ASCII letters or digits
 * gets a random base instead of a bare dot-file such as `.png`.
 *
 * Uniqueness is not decided here. Publication (lib/uploads/finalize.ts) checks
 * the URL under the owner's row lock and adds a suffix when it is taken.
 */
export function urlSafeFilename(
  originalName: string,
  randomize: boolean = false
): string {
  if (randomize) return generateRandomFileName(originalName)
  const { stem, extension } = splitExtension(originalName)
  const base = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return withExtension(base || nanoid(6), extension)
}
