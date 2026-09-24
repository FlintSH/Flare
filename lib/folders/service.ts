import type { Prisma } from '@prisma/client'
import { randomBytes } from 'node:crypto'

import { prisma } from '@/lib/database/prisma'
import type {
  FolderInput,
  FolderUpdate,
  FolderView,
} from '@/lib/folders/schema'

export class FolderError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message)
    this.name = 'FolderError'
  }
}

export const folderViewSelect = {
  id: true,
  name: true,
  parentId: true,
  shareToken: true,
  _count: { select: { files: true } },
} satisfies Prisma.VaultFolderSelect

export function folderView(
  folder: Prisma.VaultFolderGetPayload<{ select: typeof folderViewSelect }>
): FolderView {
  return {
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    shareToken: folder.shareToken,
    fileCount: folder._count.files,
  }
}

/** The caller must hold the owner's row lock when using this before a write. */
export async function validateOwnedFolderId(
  userId: string,
  folderId: string | null,
  transaction?: Prisma.TransactionClient
): Promise<string | null> {
  if (folderId === null) return null
  const folder = await (transaction ?? prisma).vaultFolder.findFirst({
    where: { id: folderId, userId },
    select: { id: true },
  })
  if (!folder) throw new FolderError('Folder not found.', 404)
  return folder.id
}

export async function createFolder(userId: string, input: FolderInput) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`
    await validateOwnedFolderId(userId, input.parentId, tx)
    const folder = await tx.vaultFolder.create({
      data: { ...input, userId, normalizedName: input.name.toLowerCase() },
      select: folderViewSelect,
    })
    return folderView(folder)
  })
}

export async function updateFolder(
  userId: string,
  id: string,
  input: FolderUpdate
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`
    const current = await tx.vaultFolder.findFirst({
      where: { id, userId },
      select: { id: true, shareToken: true },
    })
    if (!current) throw new FolderError('Folder not found.', 404)
    const folder = await tx.vaultFolder.update({
      where: { id, userId },
      data: {
        ...(input.name !== undefined
          ? { name: input.name, normalizedName: input.name.toLowerCase() }
          : {}),
        ...(input.sharing !== undefined
          ? {
              shareToken: input.sharing
                ? (current.shareToken ?? randomBytes(32).toString('base64url'))
                : null,
            }
          : {}),
      },
      select: folderViewSelect,
    })
    return folderView(folder)
  })
}

/** Dissolve a folder, moving its direct contents up one level without deleting files. */
export async function deleteFolder(userId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`
    const folder = await tx.vaultFolder.findFirst({
      where: { id, userId },
      select: { id: true, parentId: true },
    })
    if (!folder) throw new FolderError('Folder not found.', 404)
    const children = await tx.vaultFolder.findMany({
      where: { userId, parentId: id },
      select: { normalizedName: true },
    })
    if (children.length) {
      const conflict = await tx.vaultFolder.findFirst({
        where: {
          userId,
          parentId: folder.parentId,
          id: { not: id },
          normalizedName: { in: children.map((child) => child.normalizedName) },
        },
        select: { id: true },
      })
      if (conflict)
        throw new FolderError(
          'A subfolder has the same name as a folder one level up. Rename it before deleting this folder.',
          409
        )
      // A child may have the same name as this folder. Release the name before
      // reparenting it; slash-containing names cannot be created through the API.
      await tx.vaultFolder.update({
        where: { id, userId },
        data: { normalizedName: `/deleted/${id}` },
      })
      await tx.vaultFolder.updateMany({
        where: { userId, parentId: id },
        data: { parentId: folder.parentId },
      })
    }
    await tx.file.updateMany({
      where: { userId, folderId: id },
      data: { folderId: folder.parentId },
    })
    await tx.vaultFolder.delete({ where: { id, userId } })
  })
}

export async function moveFilesToFolder(
  userId: string,
  input: { fileIds: string[]; folderId: string | null }
): Promise<number> {
  const fileIds = [...new Set(input.fileIds)]
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`
    await validateOwnedFolderId(userId, input.folderId, tx)
    const ownedFiles = await tx.file.count({
      where: { id: { in: fileIds }, userId },
    })
    if (ownedFiles !== fileIds.length)
      throw new FolderError('One or more files are unavailable.', 404)
    const changed = await tx.file.updateMany({
      where: { id: { in: fileIds }, userId },
      data: { folderId: input.folderId },
    })
    // Files can also be removed by expiry workers; roll back partial moves.
    if (changed.count !== fileIds.length)
      throw new FolderError('One or more files are unavailable.', 404)
    return changed.count
  })
}
