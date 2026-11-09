import { Prisma, type SearchIndexStatus } from '@prisma/client'

import { prisma } from '@/lib/database/prisma'
import { HttpError } from '@/lib/http/errors'
import {
  BATCH_LIMIT,
  INDEX_FILTERS,
  MAX_SIZE_FILTER,
  UNFILED,
  UNTAGGED,
  VISIBILITY_FILTERS,
} from '@/lib/library/contract'
import { type SearchPlan, planSearch } from '@/lib/search/query'
import { SEARCH_INDEX_STATES } from '@/lib/search/store'
import { MAX_SEARCH_LENGTH } from '@/lib/search/text'
import { bytesToMB } from '@/lib/utils/size'

export class FileListInputError extends HttpError {
  constructor(message: string) {
    super(400, message)
    this.name = 'FileListInputError'
  }
}

function dateValue(value: string, name: string): Date {
  const date = new Date(value)
  if (Number.isNaN(date.getTime()))
    throw new FileListInputError(`${name} must be a valid date`)
  return date
}

/**
 * Keep metadata pages and SQL timeline counts on exactly the same predicates.
 * Everything but the search; {@link libraryFileFilters} adds that.
 */
export function fileListFilters(userId: string, params: URLSearchParams) {
  const conditions: Prisma.FileWhereInput[] = []
  const sqlConditions: Prisma.Sql[] = [Prisma.sql`f."userId" = ${userId}`]
  const add = (where: Prisma.FileWhereInput, sql: Prisma.Sql) => {
    conditions.push(where)
    sqlConditions.push(sql)
  }

  const idFilters = params.getAll('ids')
  if (idFilters.length) {
    const ids = idFilters[0].split(',')
    if (
      idFilters.length !== 1 ||
      ids.length > BATCH_LIMIT ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !id || id.length > 128 || /[\s\x00-\x1f\x7f]/.test(id))
    )
      throw new FileListInputError(
        `ids must contain 1 to ${BATCH_LIMIT} distinct file IDs, each at most 128 characters without whitespace or control characters`
      )
    add({ id: { in: ids } }, Prisma.sql`f.id IN (${Prisma.join(ids)})`)
  }

  const folder = params.get('folder')
  if (folder) {
    if (folder === UNFILED)
      add({ folderId: null }, Prisma.sql`f."vaultFolderId" IS NULL`)
    else
      add(
        { folderId: folder, folder: { userId } },
        Prisma.sql`f."vaultFolderId" = ${folder} AND EXISTS (
          SELECT 1 FROM "VaultFolder" folder
          WHERE folder.id = f."vaultFolderId" AND folder."userId" = ${userId}
        )`
      )
  }

  const tag = params.get('tag')
  if (tag) {
    if (tag === UNTAGGED)
      add(
        { tags: { none: { excluded: false } } },
        Prisma.sql`NOT EXISTS (SELECT 1 FROM "VaultFileTag" ft
          WHERE ft."fileId" = f.id AND ft.excluded = false)`
      )
    else
      add(
        { tags: { some: { tagId: tag, excluded: false, tag: { userId } } } },
        Prisma.sql`EXISTS (SELECT 1 FROM "VaultFileTag" ft
          JOIN "VaultTag" tag ON tag.id = ft."tagId"
          WHERE ft."fileId" = f.id AND ft."tagId" = ${tag}
            AND ft.excluded = false AND tag."userId" = ${userId})`
      )
  }

  const types = params.get('types')?.split(',') || []
  if (types.length)
    add(
      { mimeType: { in: types } },
      Prisma.sql`f."mimeType" IN (${Prisma.join(types)})`
    )

  const dateFrom = params.get('dateFrom')
  const dateTo = params.get('dateTo')
  if (dateFrom || dateTo) {
    const uploadedAt: Prisma.DateTimeFilter = {}
    const bounds: Prisma.Sql[] = []
    if (dateFrom) {
      const start = dateValue(dateFrom, 'dateFrom')
      uploadedAt.gte = start
      bounds.push(Prisma.sql`f."uploadedAt" >= ${start}`)
    }
    if (dateTo) {
      const end = dateValue(dateTo, 'dateTo')
      // Preserve legacy date-only requests; timestamp callers choose their own zone.
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) end.setHours(23, 59, 59, 999)
      uploadedAt.lte = end
      bounds.push(Prisma.sql`f."uploadedAt" <= ${end}`)
    }
    add({ uploadedAt }, Prisma.join(bounds, ' AND '))
  }

  const visibility = params.get('visibility')?.split(',') || []
  if (visibility.length) {
    const alternatives: Prisma.FileWhereInput[] = []
    const sqlAlternatives: Prisma.Sql[] = []
    for (const value of visibility) {
      // Visibility names match in any letter case, as they always have.
      const filter = VISIBILITY_FILTERS.find((option) =>
        'visibility' in option
          ? option.visibility === value.toUpperCase()
          : option.value === value
      )
      if (!filter)
        throw new FileListInputError(
          'visibility must be public, private, or hasPassword'
        )
      if ('visibility' in filter) {
        alternatives.push({ visibility: filter.visibility })
        sqlAlternatives.push(
          Prisma.sql`f.visibility = ${filter.visibility}::"FileVisibility"`
        )
      } else {
        alternatives.push({ password: { not: null } })
        sqlAlternatives.push(Prisma.sql`f.password IS NOT NULL`)
      }
    }
    add(
      { OR: alternatives },
      Prisma.sql`(${Prisma.join(sqlAlternatives, ' OR ')})`
    )
  }

  for (const [name, bound] of [
    ['minSize', 'gte'],
    ['maxSize', 'lte'],
  ] as const) {
    const value = params.get(name)
    if (value === null || value === '') continue
    const bytes = Number(value)
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_SIZE_FILTER)
      throw new FileListInputError(`${name} must be a whole number of bytes`)
    // Files record their sizes in megabytes.
    const megabytes = bytesToMB(bytes)
    add(
      { size: { [bound]: megabytes } },
      bound === 'gte'
        ? Prisma.sql`f.size >= ${megabytes}`
        : Prisma.sql`f.size <= ${megabytes}`
    )
  }

  const index = params.get('index')?.split(',').filter(Boolean) || []
  if (index.length) {
    const statuses = new Set<SearchIndexStatus>()
    for (const value of index) {
      const matching = Object.entries(SEARCH_INDEX_STATES)
        .filter(([, state]) => state === value)
        .map(([status]) => status as SearchIndexStatus)
      if (!matching.length)
        throw new FileListInputError(
          `index must name ${INDEX_FILTERS.map((filter) => filter.value).join(', ')}`
        )
      for (const status of matching) statuses.add(status)
    }
    add(
      { searchIndex: { status: { in: [...statuses] } } },
      Prisma.sql`EXISTS (SELECT 1 FROM "FileSearchIndex" si
        WHERE si."fileId" = f.id
          AND si.status::text IN (${Prisma.join([...statuses])}))`
    )
  }

  const snapshotValue = params.get('snapshot')
  const snapshot = snapshotValue ? dateValue(snapshotValue, 'snapshot') : null
  if (snapshot)
    add(
      { uploadedAt: { lte: snapshot } },
      Prisma.sql`f."uploadedAt" <= ${snapshot}`
    )

  const where: Prisma.FileWhereInput = { userId }
  if (conditions.length) where.AND = conditions
  return { where, sql: Prisma.join(sqlConditions, ' AND '), snapshot }
}

export type LibraryFileFilters =
  | {
      /** The matching files, for Prisma. */
      where: Prisma.FileWhereInput
      /** The same files: `SELECT … FROM ${from} WHERE ${sql}`, with `File` as `f`. */
      from: Prisma.Sql
      sql: Prisma.Sql
      search: null
    }
  | {
      /** A search can only be expressed in SQL. */
      where: null
      from: Prisma.Sql
      sql: Prisma.Sql
      search: SearchPlan
    }

/**
 * Every filter of a list request, including its search. A search needs the
 * owner's tags and folders, so this reads them once.
 */
export async function libraryFileFilters(
  userId: string,
  params: URLSearchParams
): Promise<LibraryFileFilters> {
  const { where, sql, snapshot } = fileListFilters(userId, params)
  const search = params.get('search') || ''
  if (search.length > MAX_SEARCH_LENGTH)
    throw new FileListInputError(
      `search must be at most ${MAX_SEARCH_LENGTH} characters`
    )
  const plan = search ? await planSearch(userId, search, snapshot) : null
  if (!plan) return { where, from: Prisma.sql`"File" f`, sql, search: null }
  const decided = params.get('searchMatch')
  if (decided !== null && decided !== 'every' && decided !== 'some')
    throw new FileListInputError('searchMatch must be every or some')
  if (plan.someMatch) {
    // The timeline decides once from the data and its pages repeat its answer,
    // so they agree and don't look again; other requests look themselves.
    if (decided) plan.partial = decided === 'some'
    else {
      const [{ found }] = await prisma.$queryRaw<{ found: boolean }[]>(
        Prisma.sql`SELECT EXISTS (SELECT 1 FROM ${plan.from} WHERE ${sql} AND ${plan.match}) AS found`
      )
      plan.partial = !found
    }
  }
  return {
    where: null,
    from: plan.from,
    sql: Prisma.sql`${sql} AND ${plan.partial ? plan.someMatch! : plan.match}`,
    search: plan,
  }
}
