import { prisma } from '@/lib/database/prisma'

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
    files: folder.files.map((file) => ({
      id: file.id,
      name: file.password ? 'Password-protected file' : file.name,
      urlPath: file.urlPath
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/'),
      mimeType: file.password ? null : file.mimeType,
      size: file.password ? null : file.size,
      hasPassword: Boolean(file.password),
    })),
  }
}
