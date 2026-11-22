/**
 * A paste's filename and the language it is highlighted as, which its
 * extension names. Browser-safe.
 */
import {
  type Language,
  extensionOf,
  languageExtension,
  languageFromFilename,
  namesLanguage,
} from './file-kind'

/** What a paste is saved as when no name is given. */
export const DEFAULT_PASTE_NAME = 'paste.txt'

/** The name a paste is saved under. */
export function pasteName(typed: string) {
  return typed.trim() || DEFAULT_PASTE_NAME
}

/** The language a paste's name gives it, plain text without one. */
export function pasteLanguage(typed: string): Language {
  return languageFromFilename(pasteName(typed))
}

/**
 * The name with its extension changed to `language`'s: `notes` becomes
 * `notes.py`, and `notes.md` becomes `notes.py`. An extension that names no
 * language, such as `report.final`, stays part of the name. An empty name
 * starts from `paste`.
 */
export function renameForLanguage(typed: string, language: Language) {
  const name = typed.trim() || 'paste'
  const extension = extensionOf(name)
  const stem =
    extension && namesLanguage(extension)
      ? name.slice(0, -(extension.length + 1))
      : name
  return `${stem || 'paste'}.${languageExtension(language)}`
}
