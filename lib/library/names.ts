/**
 * How the library's folder and tag names are written and compared. The forms
 * use it too, so this module stays browser-safe.
 */
import { z } from 'zod'

/** A name as Flare stores and shows it: NFKC, trimmed, single spaces. */
export function normalizeName(name: string) {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ')
}

/** Names are unique without regard to letter case: the stored `normalizedName`. */
export function nameKey(name: string) {
  return name.toLowerCase()
}

/** Whether a name is free of control and format characters. */
export function isPlainName(name: string) {
  return !/[\p{Cc}\p{Cf}]/u.test(name)
}

export const PLAIN_NAME_MESSAGE = 'Use a plain-text name.'

/** A normalized folder or tag name of 1 to `max` characters, in plain text. */
export function nameSchema(kind: 'folder' | 'tag', max: number) {
  const label = kind === 'folder' ? 'Folder' : 'Tag'
  return z
    .string()
    .transform(normalizeName)
    .pipe(
      z
        .string()
        .min(1, `Give your ${kind} a name.`)
        .max(max, `${label} names can be up to ${max} characters.`)
        .refine(isPlainName, PLAIN_NAME_MESSAGE)
    )
}
