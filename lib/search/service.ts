import { prisma } from '@/lib/database/prisma'
import { getFilesExpirationInfo } from '@/lib/files/expiry'
import {
  fileListItem,
  fileListSelect,
  fileOrderBy,
} from '@/lib/files/gallery-navigation'
import { searchOwnShortLinks } from '@/lib/links/service'
import {
  type PermissionSubject,
  hasPermission,
} from '@/lib/permissions/catalog'

import { FIND_LIMIT, FIND_OCR_MINIMUM } from './contract'

/**
 * What Find shows for a few typed characters: the account's own files
 * (by name, and by the text found in images once the query is long enough
 * to be worth scanning for), links and folders, a handful of each. Each
 * group needs what the account would need to list it anywhere else.
 */
export async function findOwnContent(
  user: PermissionSubject & { id: string },
  query: string
) {
  const contains = { contains: query, mode: 'insensitive' as const }
  const canFiles = hasPermission(user, 'files.read')
  const canLinks = hasPermission(user, 'links.read')

  const [files, links, folders] = await Promise.all([
    canFiles ? findOwnFiles(user.id, query) : [],
    canLinks ? searchOwnShortLinks(user.id, query, FIND_LIMIT) : [],
    canFiles
      ? prisma.vaultFolder.findMany({
          where: { userId: user.id, name: contains },
          orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
          take: FIND_LIMIT,
          select: { id: true, name: true, parentId: true },
        })
      : [],
  ])

  const expirations = await getFilesExpirationInfo(files.map(({ id }) => id))
  return {
    files: canFiles
      ? files.map((file) =>
          fileListItem(file, expirations.get(file.id) ?? null)
        )
      : null,
    links: canLinks ? links : null,
    folders: canFiles ? folders : null,
  }
}

/**
 * Files named like the query first, newest first; then, from three
 * characters, newer files whose image text matches, to fill the rest.
 */
async function findOwnFiles(userId: string, query: string) {
  const contains = { contains: query, mode: 'insensitive' as const }
  const named = await prisma.file.findMany({
    where: { userId, name: contains },
    orderBy: fileOrderBy('newest'),
    take: FIND_LIMIT,
    select: fileListSelect,
  })
  if (named.length === FIND_LIMIT || query.length < FIND_OCR_MINIMUM)
    return named
  const read = await prisma.file.findMany({
    where: {
      userId,
      ocrText: contains,
      id: { notIn: named.map(({ id }) => id) },
    },
    orderBy: fileOrderBy('newest'),
    take: FIND_LIMIT - named.length,
    select: fileListSelect,
  })
  return [...named, ...read]
}
