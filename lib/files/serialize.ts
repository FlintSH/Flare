import type { Prisma } from '@prisma/client'

import type { FileMetadata } from '@/types/dto/file'

// Shared Prisma select used when returning files to the dashboard, including the
// folder summary and tag chips.
export const fileListSelect = {
  id: true,
  name: true,
  urlPath: true,
  mimeType: true,
  size: true,
  uploadedAt: true,
  visibility: true,
  password: true,
  views: true,
  downloads: true,
  folderId: true,
  folder: { select: { id: true, name: true } },
  tags: {
    select: { tag: { select: { id: true, name: true, color: true } } },
  },
} satisfies Prisma.FileSelect

type FileWithRelations = Prisma.FileGetPayload<{ select: typeof fileListSelect }>

/**
 * Maps a Prisma file row (selected with {@link fileListSelect}) into the
 * dashboard `FileMetadata` shape, hiding the password hash and flattening tags.
 */
export function serializeFile(
  file: FileWithRelations,
  expiresAt: Date | null
): FileMetadata {
  return {
    id: file.id,
    name: file.name,
    urlPath: file.urlPath,
    mimeType: file.mimeType,
    size: file.size,
    uploadedAt: file.uploadedAt,
    visibility: file.visibility,
    views: file.views,
    downloads: file.downloads,
    hasPassword: Boolean(file.password),
    expiresAt,
    folderId: file.folderId,
    folder: file.folder ? { id: file.folder.id, name: file.folder.name } : null,
    tags: file.tags.map((ft) => ({
      id: ft.tag.id,
      name: ft.tag.name,
      color: ft.tag.color,
    })),
  }
}
