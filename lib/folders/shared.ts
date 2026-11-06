import { prisma } from '@/lib/database/prisma'
import {
  fileUrls,
  sharedFolderFileUrl,
  sharedFolderUrl,
} from '@/lib/files/urls'

export const SHARED_FOLDER_PAGE_SIZE = 48

/** Public reads deliberately omit owner details, tags, private files and subfolders. */
export async function getSharedFolder(token: string, page = 1) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) return null
  const currentPage = page
  const folder = await prisma.vaultFolder.findUnique({
    where: { shareToken: token },
    select: {
      name: true,
      files: {
        where: { visibility: 'PUBLIC' },
        orderBy: [{ uploadedAt: 'desc' }, { id: 'asc' }],
        skip: (currentPage - 1) * SHARED_FOLDER_PAGE_SIZE,
        take: SHARED_FOLDER_PAGE_SIZE,
        select: {
          id: true,
          name: true,
          urlPath: true,
          mimeType: true,
          size: true,
          password: true,
        },
      },
      _count: { select: { files: { where: { visibility: 'PUBLIC' } } } },
    },
  })
  if (!folder) return null
  return {
    name: folder.name,
    page: currentPage,
    total: folder._count.files,
    pageCount: Math.ceil(folder._count.files / SHARED_FOLDER_PAGE_SIZE),
    files: folder.files.map((file) => {
      const urls = fileUrls(file)
      return {
        id: file.id,
        name: file.password ? 'Password-protected file' : file.name,
        // Even the link target must hide a protected file's filename. This
        // route checks membership and the password before revealing its
        // canonical URL.
        href: file.password ? sharedFolderFileUrl(token, file.id) : urls.page,
        rawUrl: file.password ? null : urls.raw,
        mimeType: file.password ? null : file.mimeType,
        size: file.password ? null : file.size,
        hasPassword: Boolean(file.password),
      }
    }),
  }
}

/**
 * A visitor who opened this file from a shared folder gets a link back to it.
 * Shared folder pages send their address as the referrer to this origin only,
 * so the folder's share token never has to appear in the file's own URL. The
 * link appears only while the file is still a public member of that folder.
 */
export async function sharedFolderBackLink(
  file: { folderId: string | null; visibility: string },
  referer: string | null
): Promise<{ href: string; label: string } | null> {
  if (!referer || !file.folderId || file.visibility !== 'PUBLIC') return null
  let from: URL
  try {
    from = new URL(referer)
  } catch {
    return null
  }
  const match =
    /^\/s\/folders\/([A-Za-z0-9_-]{20,100})(\/files\/[^/]+)?\/?$/.exec(
      from.pathname
    )
  if (!match) return null
  const [, token, viaFileRoute] = match
  const folder = await prisma.vaultFolder.findUnique({
    where: { shareToken: token },
    select: { id: true, name: true },
  })
  if (!folder || folder.id !== file.folderId) return null
  const page = viaFileRoute ? 1 : Number(from.searchParams.get('page') ?? 1)
  return {
    href: sharedFolderUrl(token, {
      page: Number.isSafeInteger(page) && page <= 100000 ? page : 1,
    }),
    label: folder.name,
  }
}
