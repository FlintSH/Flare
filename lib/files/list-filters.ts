import { Prisma } from '@prisma/client'

export class FileListInputError extends Error {}

function dateValue(value: string, name: string): Date {
  const date = new Date(value)
  if (Number.isNaN(date.getTime()))
    throw new FileListInputError(`${name} must be a valid date`)
  return date
}

/** Keep metadata pages and SQL timeline counts on exactly the same predicates. */
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
      ids.length > 100 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !id || id.length > 128 || /[\s\x00-\x1f\x7f]/.test(id))
    )
      throw new FileListInputError(
        'ids must contain 1 to 100 distinct file IDs, each at most 128 characters without whitespace or control characters'
      )
    add({ id: { in: ids } }, Prisma.sql`f.id IN (${Prisma.join(ids)})`)
  }

  const folder = params.get('folder')
  if (folder) {
    if (folder === 'unfiled')
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
    if (tag === 'untagged')
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

  const search = params.get('search') || ''
  if (search)
    add(
      {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { ocrText: { contains: search, mode: 'insensitive' } },
        ],
      },
      Prisma.sql`(f.name ILIKE ${`%${search}%`} OR f."ocrText" ILIKE ${`%${search}%`})`
    )

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
    for (const filter of visibility) {
      if (filter === 'hasPassword') {
        alternatives.push({ password: { not: null } })
        sqlAlternatives.push(Prisma.sql`f.password IS NOT NULL`)
      } else {
        const value = filter.toUpperCase()
        if (value !== 'PUBLIC' && value !== 'PRIVATE')
          throw new FileListInputError(
            'visibility must be public, private, or hasPassword'
          )
        alternatives.push({ visibility: value })
        sqlAlternatives.push(
          Prisma.sql`f.visibility = ${value}::"FileVisibility"`
        )
      }
    }
    add(
      { OR: alternatives },
      Prisma.sql`(${Prisma.join(sqlAlternatives, ' OR ')})`
    )
  }

  const snapshotValue = params.get('snapshot')
  if (snapshotValue) {
    const snapshot = dateValue(snapshotValue, 'snapshot')
    add(
      { uploadedAt: { lte: snapshot } },
      Prisma.sql`f."uploadedAt" <= ${snapshot}`
    )
  }

  const where: Prisma.FileWhereInput = { userId }
  if (conditions.length) where.AND = conditions
  return { where, sql: Prisma.join(sqlConditions, ' AND ') }
}
