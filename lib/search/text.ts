/**
 * How library search reads text and queries. Shared by the server, which
 * matches and indexes with it, and the dashboard, which highlights matches with
 * it, so the two always agree. Browser-safe: imports nothing.
 */

const MARKS = /\p{M}+/gu

function latinAccent(codePoint: number) {
  return (
    (codePoint >= 0xc0 && codePoint <= 0x24f) ||
    (codePoint >= 0x1e00 && codePoint <= 0x1eff)
  )
}

/**
 * Lower case without Latin accents, keeping the string's length: "Résumé" is
 * "resume". Exactly the characters the database's `flare_search_fold` maps
 * are folded: Latin letters that decompose into one ASCII letter plus marks.
 * Positions found in folded text are positions in the original.
 */
export function foldText(value: string): string {
  let folded = ''
  for (const character of value) {
    const lower = character.toLowerCase()
    const base = character.normalize('NFKD').replace(MARKS, '').toLowerCase()
    if (latinAccent(character.codePointAt(0)!) && /^[a-z]$/.test(base))
      folded += base
    // "İ" is folded above; other expansions would move later positions.
    else folded += lower.length === character.length ? lower : character
  }
  return folded
}

/**
 * Characters people use in place of spaces in filenames. Removing them lets
 * "finalreport" find "final_report (2).docx" and "2024-03-01" find
 * "IMG20240301.jpg". The database removes exactly the same characters.
 */
export const NAME_SEPARATORS = ' \t_.,;:!?()[]{}\'"+#~=&@/\\|-'

export function compactText(value: string): string {
  let compact = ''
  for (const character of value)
    if (!NAME_SEPARATORS.includes(character)) compact += character
  return compact
}

/** Words longer than this are cut; nobody searches for them whole. */
export const MAX_TOKEN_LENGTH = 64
const WORD = /[\p{L}\p{N}]+/gu

/** The folded words of a text, as the content index stores them. */
export function tokenize(value: string): string[] {
  return (foldText(value).match(WORD) ?? []).map((word) =>
    word.slice(0, MAX_TOKEN_LENGTH)
  )
}

/**
 * The prefix a typed word is looked up by: the word itself, without a
 * trailing "s" once it's longer than four letters, so "receipts" also finds
 * "receipt". The content index and highlighting both use it.
 */
export function wordPrefix(token: string): string {
  return token.length > 4 && token.endsWith('s') && !/\d/.test(token)
    ? token.slice(0, -1)
    : token
}

/**
 * Recognized text, or nothing when it has no word of two or more letters or
 * digits. Recognition reads stray marks in photos as "a" or "»".
 */
export function recognizedText(text: string): string {
  return tokenize(text).some((word) => word.length > 1) ? text : ''
}

export type SearchField = 'any' | 'name' | 'text' | 'tag' | 'folder' | 'type'

export interface SearchTerm {
  /** Folded text to look for. For `type`, an extension without its dot. */
  value: string
  field: SearchField
  /** Written in quotes: its words must appear together, in order. */
  phrase: boolean
  /** Written with a leading minus: matching files are left out. */
  negated: boolean
}

export interface ParsedSearch {
  terms: SearchTerm[]
  /** The terms that choose and rank files, without exclusions. */
  positive: SearchTerm[]
}

/** More terms are ignored; each one adds work to every search. */
export const MAX_SEARCH_TERMS = 12
export const MAX_SEARCH_LENGTH = 500

const FIELD_ALIASES: Record<string, SearchField> = {
  name: 'name',
  filename: 'name',
  text: 'text',
  content: 'text',
  contents: 'text',
  ocr: 'text',
  tag: 'tag',
  folder: 'folder',
  in: 'folder',
  type: 'type',
  ext: 'type',
}

/**
 * Read a search box query. Words match anywhere; `"exact words"` keeps words
 * together; `-word` leaves files out; `name:`, `text:`, `tag:`, `folder:`
 * (or `in:`) and `type:` (or `ext:`) look in one place. An unknown prefix,
 * such as the time in "10:32", is part of the word.
 */
export function parseSearch(query: string): ParsedSearch {
  const terms: SearchTerm[] = []
  const input = query.slice(0, MAX_SEARCH_LENGTH)
  const pattern = /(-?)(?:([\p{L}]+):)?(?:"([^"]*)"?|(\S+))/gu
  for (const match of input.matchAll(pattern)) {
    if (terms.length >= MAX_SEARCH_TERMS) break
    const [, minus, prefix, quoted, bare] = match
    // A lone minus, as while someone is still typing an exclusion.
    if (!prefix && bare === '-') continue
    let field: SearchField = 'any'
    let raw = quoted ?? bare ?? ''
    const known = prefix ? FIELD_ALIASES[prefix.toLowerCase()] : undefined
    if (prefix && !known) raw = `${prefix}:${raw}`
    else if (known) field = known
    // A lone "-" or a quoted nothing.
    let value = foldText(raw).trim()
    if (field === 'type') value = value.replace(/^\*?\./, '')
    if (!value) continue
    terms.push({
      value: value.slice(0, 100),
      field,
      phrase: quoted !== undefined,
      negated: minus === '-',
    })
  }
  return { terms, positive: terms.filter((term) => !term.negated) }
}

/** Whether a term can look in the field. */
export function termLooksIn(term: SearchTerm, field: SearchField): boolean {
  return term.field === 'any' || term.field === field
}

export interface TextRange {
  start: number
  end: number
}

/**
 * Where the words of the terms appear in a text, merged and in order. Word
 * terms are found at the start of a word, as the content index matches them;
 * name terms anywhere, as names are matched.
 */
export function findTermRanges(
  text: string,
  terms: SearchTerm[],
  mode: 'words' | 'anywhere'
): TextRange[] {
  const folded = foldText(text)
  const ranges: TextRange[] = []
  const needles = new Set<string>()
  for (const term of terms) {
    if (mode === 'anywhere') needles.add(term.value)
    else {
      const tokens = tokenize(term.value)
      if (!tokens.length) continue
      // The last word is a prefix, as the index matches it.
      tokens.push(wordPrefix(tokens.pop()!))
      if (term.phrase || tokens.length > 1) needles.add(tokens.join(' '))
      else needles.add(tokens[0])
    }
  }
  for (const needle of needles) {
    if (!needle) continue
    let from = 0
    for (;;) {
      const index = folded.indexOf(needle, from)
      if (index < 0) break
      from = index + 1
      if (
        mode === 'words' &&
        index > 0 &&
        /[\p{L}\p{N}]/u.test(folded[index - 1])
      )
        continue
      ranges.push({ start: index, end: index + needle.length })
    }
  }
  ranges.sort((a, b) => a.start - b.start || b.end - a.end)
  const merged: TextRange[] = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range.start <= last.end)
      last.end = Math.max(last.end, range.end)
    else merged.push({ ...range })
  }
  return merged
}

/** A piece of a snippet or name, highlighted when it matched. */
export interface TextSegment {
  text: string
  match?: true
}

export function segmentText(text: string, ranges: TextRange[]): TextSegment[] {
  const segments: TextSegment[] = []
  let at = 0
  for (const { start, end } of ranges) {
    if (start > at) segments.push({ text: text.slice(at, start) })
    segments.push({ text: text.slice(start, end), match: true })
    at = end
  }
  if (at < text.length) segments.push({ text: text.slice(at) })
  return segments
}
