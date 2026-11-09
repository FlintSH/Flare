import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/database/prisma'

import type { ContentSource, FileMatch } from './contract'
import {
  NAME_SEPARATORS,
  type ParsedSearch,
  type SearchTerm,
  type TextSegment,
  compactText,
  findTermRanges,
  foldText,
  parseSearch,
  segmentText,
  termLooksIn,
  tokenize,
  wordPrefix,
} from './text'

/** Points a term earns for each place it matches. Ties go to newer files. */
const WEIGHTS = { name: 10, tag: 6, folder: 4, content: 3 } as const
/** Extra points when every word appears together in the name, in order. */
const WHOLE_NAME_BONUS = 8

const FOLD = (column: Prisma.Sql) => Prisma.sql`flare_search_fold(${column})`

function likePattern(value: string) {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`
}

/**
 * The filename folded: lower case without accents. Folding accents costs far
 * more than `lower()`, so only names with characters outside ASCII are
 * folded; for the rest the two are the same.
 */
// More bytes than characters means a character outside ASCII, without a regex.
const FOLDED_NAME = Prisma.sql`CASE WHEN octet_length(f.name) <> char_length(f.name) THEN ${FOLD(Prisma.sql`f.name`)} ELSE lower(f.name) END`
/** The folded filename without separators. */
const compactName = (folded: Prisma.Sql) =>
  Prisma.sql`translate(${folded}, ${NAME_SEPARATORS}, '')`

/**
 * The filename contains `value`, ignoring case, accents and separators. Reads
 * the folded name and its compact form from the given expressions.
 */
function nameContains(
  value: string,
  folded: Prisma.Sql = FOLDED_NAME,
  compact: Prisma.Sql = compactName(FOLDED_NAME)
) {
  const conditions = [
    Prisma.sql`${folded} LIKE ${likePattern(value)} ESCAPE '\\'`,
  ]
  // "finalreport" finds "Final_Report (2).docx", "2024-03-01" "IMG20240301".
  const compactValue = compactText(value)
  if (compactValue)
    conditions.push(
      Prisma.sql`${compact} LIKE ${likePattern(compactValue)} ESCAPE '\\'`
    )
  return Prisma.sql`(${Prisma.join(conditions, ' OR ')})`
}

const KIND_PREFIXES: Record<string, string> = {
  image: 'image/',
  photo: 'image/',
  picture: 'image/',
  screenshot: 'image/',
  video: 'video/',
  movie: 'video/',
  audio: 'audio/',
  sound: 'audio/',
  music: 'audio/',
  text: 'text/',
}

function typeCondition(value: string) {
  const singular = value.replace(/s$/, '')
  const prefix = Object.hasOwn(KIND_PREFIXES, singular)
    ? KIND_PREFIXES[singular]
    : undefined
  if (prefix) return Prisma.sql`f."mimeType" LIKE ${`${prefix}%`}`
  const extension = value.replace(/[\\%_]/g, (character) => `\\${character}`)
  return Prisma.sql`(lower(f.name) LIKE ${`%.${extension}`} ESCAPE '\\'
    OR lower(f."mimeType") LIKE ${`%/${extension}`} ESCAPE '\\'
    OR lower(f."mimeType") LIKE ${`%/x-${extension}`} ESCAPE '\\')`
}

/**
 * The content index query for a term: its words in order, the last as a
 * prefix so "invoic" and "invoices" both find "invoice". A trailing "s" is
 * dropped from a prefix, so "receipts" also finds "receipt".
 */
export function contentQuery(term: SearchTerm, weight = ''): string | null {
  const tokens = tokenize(term.value)
  if (!tokens.length) return null
  return tokens
    .map((token, index) => {
      if (index < tokens.length - 1)
        return `'${token}'${weight ? `:${weight}` : ''}`
      const prefix = wordPrefix(token)
      return `'${prefix}':*${weight}`
    })
    .join(' <-> ')
}

interface Library {
  tags: { id: string; name: string; folded: string }[]
  folders: { id: string; path: string; folded: string }[]
}

async function loadLibrary(
  userId: string,
  needTags: boolean,
  needFolders: boolean
): Promise<Library> {
  const [tags, folders] = await Promise.all([
    needTags
      ? prisma.vaultTag.findMany({
          where: { userId },
          select: { id: true, name: true },
        })
      : [],
    needFolders
      ? prisma.vaultFolder.findMany({
          where: { userId },
          select: { id: true, name: true, parentId: true },
        })
      : [],
  ])
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const paths = new Map<string, string>()
  const pathOf = (id: string): string => {
    const known = paths.get(id)
    if (known !== undefined) return known
    const names: string[] = []
    const seen = new Set<string>()
    for (
      let at = byId.get(id);
      at && !seen.has(at.id);
      at = at.parentId ? byId.get(at.parentId) : undefined
    ) {
      seen.add(at.id)
      names.unshift(at.name)
    }
    const path = names.join(' / ')
    paths.set(id, path)
    return path
  }
  return {
    tags: tags.map((tag) => ({ ...tag, folded: foldText(tag.name) })),
    folders: folders.map((folder) => {
      const path = pathOf(folder.id)
      return { id: folder.id, path, folded: foldText(path) }
    }),
  }
}

function matchingIds(items: { id: string; folded: string }[], value: string) {
  const compact = compactText(value)
  return items
    .filter(
      (item) =>
        item.folded.includes(value) ||
        (!!compact && compactText(item.folded).includes(compact))
    )
    .map((item) => item.id)
}

interface TermPlan {
  term: SearchTerm
  /** Conditions for each place the term may match. */
  name?: Prisma.Sql
  type?: Prisma.Sql
  tag?: Prisma.Sql
  folder?: Prisma.Sql
  content?: Prisma.Sql
  tagIds: string[]
  folderIds: string[]
}

export interface SearchPlan {
  parsed: ParsedSearch
  /**
   * The files to search, as `f`, joined to `hits`: which words each file's
   * indexed text has, found in one pass over the owner's index.
   * {@link match}, {@link someMatch} and {@link score} read `hits`, so every
   * query that uses them selects from this.
   */
  from: Prisma.Sql
  /** True when the file matches every term. */
  match: Prisma.Sql
  /**
   * True when the file matches at least one of the plain words, plus every
   * exclusion and every term limited to one place. Null with one plain word.
   */
  someMatch: Prisma.Sql | null
  /** Whether the list uses {@link someMatch} because no file matched them all. */
  partial: boolean
  /**
   * The plain words, each with the condition that it matches somewhere. Reads
   * `File` as `f` and the file's index row as `i`.
   */
  words: { value: string; condition: Prisma.Sql }[]
  /** The file's relevance. */
  score: Prisma.Sql
  terms: TermPlan[]
  library: Library
  userId: string
}

const NEVER = Prisma.sql`FALSE`

/**
 * Turn a search box query into SQL over one owner's files. Null when the
 * query has nothing to look for; a query of only exclusions lists every
 * other file. Content matches are bounded by `snapshot`
 * when given, so a list read in pages doesn't shift while files are indexed.
 */
export async function planSearch(
  userId: string,
  query: string,
  snapshot: Date | null
): Promise<SearchPlan | null> {
  const parsed = parseSearch(query)
  if (!parsed.terms.length) return null
  const library = await loadLibrary(
    userId,
    parsed.terms.some((term) => termLooksIn(term, 'tag')),
    parsed.terms.some((term) => termLooksIn(term, 'folder'))
  )
  const indexed = snapshot
    ? Prisma.sql`AND i."indexedAt" <= ${snapshot}`
    : Prisma.empty

  const terms = parsed.terms.map((term): TermPlan => {
    const plan: TermPlan = { term, tagIds: [], folderIds: [] }
    if (term.field === 'type') {
      plan.type = typeCondition(term.value)
      return plan
    }
    if (termLooksIn(term, 'name')) plan.name = nameContains(term.value)
    if (termLooksIn(term, 'tag')) {
      plan.tagIds = matchingIds(library.tags, term.value)
      plan.tag = plan.tagIds.length
        ? Prisma.sql`EXISTS (SELECT 1 FROM "VaultFileTag" ft
            WHERE ft."fileId" = f.id AND ft.excluded = false
              AND ft."tagId" IN (${Prisma.join(plan.tagIds)}))`
        : NEVER
    }
    if (termLooksIn(term, 'folder')) {
      plan.folderIds = matchingIds(library.folders, term.value)
      plan.folder = plan.folderIds.length
        ? // An unfiled file's folder is NULL; NOT of NULL would hide it.
          Prisma.sql`COALESCE(f."vaultFolderId" IN (${Prisma.join(plan.folderIds)}), FALSE)`
        : NEVER
    }
    if (termLooksIn(term, 'text')) {
      const tsquery = contentQuery(term)
      plan.content = tsquery
        ? Prisma.sql`f.id IN (SELECT i."fileId" FROM "FileSearchIndex" i
            WHERE i."userId" = ${userId} AND i.vector @@ ${tsquery}::tsquery ${indexed})`
        : NEVER
    }
    return plan
  })

  // One pass over the owner's index finds every word's content matches, so
  // the match and the score read a column instead of searching again.
  const contentQueries: string[] = []
  const refs = terms.map((plan) => {
    let content = plan.content
    const tsquery = content && content !== NEVER && contentQuery(plan.term)
    if (tsquery) {
      content = Prisma.raw(`COALESCE(hits.h${contentQueries.length}, FALSE)`)
      contentQueries.push(tsquery)
    }
    return {
      ...plan,
      content,
    }
  })

  const anywhere = (plan: TermPlan) => {
    const places = [
      plan.name,
      plan.type,
      plan.tag,
      plan.folder,
      plan.content,
    ].filter((place): place is Prisma.Sql => !!place)
    return Prisma.sql`(${Prisma.join(places, ' OR ')})`
  }
  const condition = (plan: TermPlan) =>
    plan.term.negated ? Prisma.sql`NOT ${anywhere(plan)}` : anywhere(plan)
  const match = Prisma.join(refs.map(condition), ' AND ')
  // People rarely remember every word in a file. When nothing has them all,
  // files with some of the plain words are better than none.
  const isOptional = (plan: TermPlan) =>
    !plan.term.negated && plan.term.field === 'any'
  const optional = refs.filter(isOptional)
  const someMatch =
    optional.length > 1
      ? Prisma.join(
          [
            ...refs.filter((plan) => !isOptional(plan)).map(condition),
            Prisma.sql`(${Prisma.join(optional.map(anywhere), ' OR ')})`,
          ],
          ' AND '
        )
      : null

  const points: Prisma.Sql[] = []
  for (const plan of refs) {
    if (plan.term.negated) continue
    for (const place of ['name', 'tag', 'folder', 'content'] as const) {
      const condition = plan[place]
      if (condition && condition !== NEVER)
        points.push(
          Prisma.sql`CASE WHEN ${condition} THEN ${WEIGHTS[place]} ELSE 0 END`
        )
    }
    if (plan.type) points.push(Prisma.sql`1`)
  }
  const words = parsed.positive.filter(
    (term) => term.field === 'any' || term.field === 'name'
  )
  if (words.length > 1)
    points.push(
      Prisma.sql`CASE WHEN ${nameContains(words.map((term) => term.value).join(' '))} THEN ${WHOLE_NAME_BONUS} ELSE 0 END`
    )
  const score = points.length ? Prisma.join(points, ' + ') : Prisma.sql`0`
  // OFFSET 0 keeps PostgreSQL from folding the row back into the outer query,
  // which would repeat each condition wherever the match and score use it.
  const hits = contentQueries.length
    ? Prisma.sql`LEFT JOIN (
        SELECT i."fileId", ${Prisma.join(
          contentQueries.map(
            (query, index) =>
              Prisma.sql`i.vector @@ ${query}::tsquery AS ${Prisma.raw(`h${index}`)}`
          ),
          ', '
        )}
        FROM "FileSearchIndex" i
        WHERE i."userId" = ${userId} ${indexed}
          AND i.vector @@ ${contentQueries.map((query) => `(${query})`).join(' | ')}::tsquery
      ) hits ON hits."fileId" = f.id`
    : Prisma.empty
  const from = Prisma.sql`"File" f ${hits}`

  return {
    parsed,
    from,
    match: Prisma.sql`(${match})`,
    someMatch: someMatch && Prisma.sql`(${someMatch})`,
    partial: false,
    // Explanations read the page's own index rows, as `i`.
    words: terms.filter(isOptional).map((plan) => {
      const query =
        plan.content && plan.content !== NEVER && contentQuery(plan.term)
      return {
        value: plan.term.value,
        condition: anywhere({
          ...plan,
          content: query
            ? Prisma.sql`COALESCE(i.vector @@ ${query}::tsquery, FALSE)`
            : plan.content,
        }),
      }
    }),
    score: Prisma.sql`(${score})`,
    terms,
    library,
    userId,
  }
}

export type { FileMatch }

const SNIPPET_BEFORE = 30
const SNIPPET_LENGTH = 160
const ENTRY_EXAMPLES = 3

/**
 * The stretch of text with the most different search words, cut at word
 * boundaries and marked. Cards show about two lines of it.
 */
export function snippet(text: string, terms: SearchTerm[]): TextSegment[] {
  const ranges = findTermRanges(text, terms, 'words')
  // Slide a window over the matches, which come sorted and don't overlap,
  // counting the different words inside it. Linear in the number of matches.
  const reach = SNIPPET_LENGTH - SNIPPET_BEFORE
  const counts = new Map<string, number>()
  const word = (index: number) =>
    text.slice(ranges[index].start, ranges[index].end).toLowerCase()
  let best = ranges[0]
  let bestWords = 0
  let next = 0
  for (let first = 0; first < Math.min(ranges.length, 50); first++) {
    const limit = ranges[first].start + reach
    for (; next < ranges.length && ranges[next].end <= limit; next++) {
      const key = word(next)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    if (counts.size > bestWords) {
      best = ranges[first]
      bestWords = counts.size
    }
    if (first < next) {
      const key = word(first)
      const left = (counts.get(key) ?? 1) - 1
      if (left) counts.set(key, left)
      else counts.delete(key)
    }
  }
  const first = best?.start ?? 0
  let start = Math.max(0, first - SNIPPET_BEFORE)
  if (start > 0) {
    const space = text.indexOf(' ', start)
    if (space >= 0 && space < first) start = space + 1
  }
  let end = Math.min(text.length, start + SNIPPET_LENGTH)
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end)
    if (space > Math.max(start, best?.end ?? 0)) end = space
  }
  const window = text.slice(start, end)
  const segments = segmentText(
    window,
    ranges
      .filter((range) => range.start >= start && range.end <= end)
      .map((range) => ({ start: range.start - start, end: range.end - start }))
  )
  if (start > 0) segments.unshift({ text: '…' })
  if (end < text.length) segments.push({ text: '…' })
  return segments
}

/**
 * Explain each result: which places matched, with the matching text. Reads
 * only the given files, which the caller has already limited to the owner.
 */
export async function explainMatches(
  plan: SearchPlan,
  files: {
    id: string
    folderId: string | null
    tags: { id: string; name: string }[]
  }[]
): Promise<Map<string, FileMatch>> {
  const explanations = new Map<string, FileMatch>()
  if (!files.length) return explanations
  const positive = plan.terms.filter((term) => !term.term.negated)
  const contentTerms = positive
    .filter((term) => term.content)
    .map((term) => term.term)
  const queries = (weight: string) =>
    contentTerms
      .map((term) => contentQuery(term, weight))
      .filter((query): query is string => !!query)
      .map((query) => `(${query})`)
      .join(' | ')
  const inContent = queries('C')
  const inEntries = queries('D')
  const names = positive.flatMap((term) => (term.name ? [term.name] : []))
  const rows = await prisma.$queryRaw<
    {
      id: string
      name: boolean
      source: ContentSource | null
      content: string | null
      entries: string | null
      hits: boolean[] | null
    }[]
  >`
    SELECT f.id,
      ${plan.partial && plan.words.length ? Prisma.sql`ARRAY[${Prisma.join(plan.words.map((word) => word.condition))}]` : Prisma.sql`NULL::boolean[]`} AS hits,
      ${names.length ? Prisma.sql`(${Prisma.join(names, ' OR ')})` : Prisma.sql`FALSE`} AS name,
      i.source,
      ${inContent ? Prisma.sql`CASE WHEN i.vector @@ ${inContent}::tsquery THEN i.content END` : Prisma.sql`NULL`} AS content,
      ${inEntries ? Prisma.sql`CASE WHEN i.vector @@ ${inEntries}::tsquery THEN i.entries END` : Prisma.sql`NULL`} AS entries
    FROM "File" f
    LEFT JOIN "FileSearchIndex" i ON i."fileId" = f.id
    WHERE f."userId" = ${plan.userId} AND f.id IN (${Prisma.join(files.map((file) => file.id))})
  `
  const tagIds = new Set(positive.flatMap((term) => term.tagIds))
  const folderIds = new Set(positive.flatMap((term) => term.folderIds))
  const folders = new Map(
    plan.library.folders.map((folder) => [folder.id, folder.path])
  )
  const byId = new Map(rows.map((row) => [row.id, row]))
  for (const file of files) {
    const row = byId.get(file.id)
    if (!row) continue
    let entries: FileMatch['entries'] = null
    if (row.entries) {
      const matching = row.entries
        .split('\n')
        .filter((path) => findTermRanges(path, contentTerms, 'words').length)
      if (matching.length)
        entries = {
          paths: matching
            .slice(0, ENTRY_EXAMPLES)
            .map((path) =>
              segmentText(path, findTermRanges(path, contentTerms, 'words'))
            ),
          more: Math.max(0, matching.length - ENTRY_EXAMPLES),
        }
    }
    explanations.set(file.id, {
      name: row.name,
      tags: file.tags.filter((tag) => tagIds.has(tag.id)),
      folder:
        file.folderId && folderIds.has(file.folderId)
          ? { id: file.folderId, path: folders.get(file.folderId) ?? '' }
          : null,
      content:
        row.content && row.source
          ? { source: row.source, snippet: snippet(row.content, contentTerms) }
          : null,
      entries,
      missing: plan.words
        .filter((_, index) => row.hits && !row.hits[index])
        .map((word) => word.value),
    })
  }
  return explanations
}
