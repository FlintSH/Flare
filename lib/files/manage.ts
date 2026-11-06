import type { FileVisibility, Prisma } from '@prisma/client'
import { z } from 'zod'

import { recordAudit, setAuditTarget } from '@/lib/audit'
import { prisma } from '@/lib/database/prisma'
import { HttpError } from '@/lib/http/errors'
import { pageWindow } from '@/lib/http/pagination'
import { loggers } from '@/lib/logger'
import { getStorageProvider } from '@/lib/storage'

import { hashFilePassword } from './password-hash'
import { newFilePasswordSchema } from './password-policy'

const logger = loggers.files

/**
 * Whose authority a file change runs under. The route has already checked
 * the permission: `files.share` or `files.delete` for the owner,
 * `content.update` or `content.delete` for a moderator.
 */
export type FileAuthority =
  /** The signed-in account; another account's file is refused with 401. */
  | { as: 'owner'; userId: string }
  /** A moderator acting on one account's files; any other file is missing. */
  | { as: 'moderator'; accountId: string }

/** Visibility and password changes. An empty or null password removes protection. */
export const fileSettingsSchema = z.object({
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  password: newFilePasswordSchema.nullable().optional(),
})

export type FileSettings = z.infer<typeof fileSettingsSchema>

export interface AccountFileQuery {
  page: number
  limit: number
  /** Matched in the name or the extracted text, ignoring case. */
  search: string
  /** `PUBLIC` or `PRIVATE` in any letter case; empty for both. */
  visibility: string
  /** A MIME type prefix, such as `image/`. */
  type: string
}

const managedFileSelect = {
  id: true,
  name: true,
  userId: true,
  path: true,
  size: true,
} satisfies Prisma.FileSelect

const accountFileSelect = {
  id: true,
  name: true,
  mimeType: true,
  size: true,
  visibility: true,
  uploadedAt: true,
  urlPath: true,
  isPaste: true,
  password: true,
} satisfies Prisma.FileSelect

/** Moderators reach a file only through the account that owns it. */
function fileWhere(
  authority: FileAuthority,
  id: string
): Prisma.FileWhereUniqueInput {
  return authority.as === 'moderator'
    ? { id, userId: authority.accountId }
    : { id }
}

async function findManagedFile(
  authority: FileAuthority,
  where: Prisma.FileWhereUniqueInput
) {
  const file = await prisma.file.findUnique({
    where,
    select: managedFileSelect,
  })
  if (!file) throw new HttpError(404, 'File not found')
  if (authority.as === 'owner' && file.userId !== authority.userId)
    throw new HttpError(401, 'Unauthorized')
  return file
}

/**
 * Change a file's visibility or password. Answers the whole stored file with
 * `hasPassword` in place of the password hash.
 */
export async function updateFileSettings(
  authority: FileAuthority,
  id: string,
  { visibility, password }: FileSettings
) {
  const where = fileWhere(authority, id)
  await findManagedFile(authority, where)
  const data: Prisma.FileUpdateInput = {}
  if (visibility) data.visibility = visibility
  if (password !== undefined) data.password = await hashFilePassword(password)
  const { password: passwordHash, ...file } = await prisma.file.update({
    where,
    data,
  })
  return { ...file, hasPassword: Boolean(passwordHash) }
}

/**
 * Delete a file now: its bytes from the active storage provider, then its
 * record and its size from the owner's storage use. A storage failure is
 * audited and logged, and the record is deleted anyway. Account deletion
 * queues its files' bytes in `lib/storage/deletion.ts` instead.
 */
export async function deleteFile(authority: FileAuthority, id: string) {
  const where = fileWhere(authority, id)
  const file = await findManagedFile(authority, where)
  setAuditTarget({ type: 'file', id: file.id, name: file.name })
  try {
    const storage = await getStorageProvider()
    await storage.deleteFile(file.path)
    await recordAudit({
      action: 'storage.deleted',
      category: 'storage',
      targetType: 'file',
      targetId: file.id,
      targetName: file.name,
    })
  } catch (error) {
    await recordAudit({
      action: 'storage.delete_failed',
      category: 'storage',
      outcome: 'failure',
      targetType: 'file',
      targetId: file.id,
      targetName: file.name,
      details: {
        reason: 'Storage deletion failed; file metadata deletion continues',
        ownerId: file.userId,
      },
    })
    logger.error('Error deleting file from storage', error as Error, {
      fileId: file.id,
      filePath: file.path,
    })
  }
  await prisma.$transaction(async (tx) => {
    await tx.file.delete({ where })
    await tx.user.update({
      where: { id: file.userId },
      data: { storageUsed: { decrement: file.size } },
    })
  })
}

/** Visibility names match in any letter case, as in the owner's list; anything else is refused. */
function visibilityFilter(value: string): FileVisibility | undefined {
  if (!value) return undefined
  const visibility = value.toUpperCase()
  if (visibility !== 'PUBLIC' && visibility !== 'PRIVATE')
    throw new HttpError(400, 'visibility must be public or private')
  return visibility
}

/**
 * A file in `listAccountFiles` as `GET /api/users/{id}/files` sends it. The
 * stored visibility of a password-protected file isn't sent.
 */
export type AccountFile = Omit<
  Prisma.FileGetPayload<{ select: typeof accountFileSelect }>,
  'password' | 'visibility' | 'uploadedAt'
> & {
  visibility: FileVisibility | 'PROTECTED'
  uploadedAt: string
}

/**
 * One page of an account's files for moderators, newest first: 10 unless
 * asked, at most 100. A password-protected file reports the visibility
 * `PROTECTED`, which the Users screen reads; no hash is sent.
 */
export async function listAccountFiles(
  accountId: string,
  query: AccountFileQuery
) {
  const visibility = visibilityFilter(query.visibility)
  const where: Prisma.FileWhereInput = {
    userId: accountId,
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { ocrText: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(visibility ? { visibility } : {}),
    ...(query.type ? { mimeType: { startsWith: query.type } } : {}),
  }
  const total = await prisma.file.count({ where })
  const { page, pages, limit, skip } = pageWindow(total, query, {
    defaultLimit: 10,
    maxLimit: 100,
  })
  const files = await prisma.file.findMany({
    where,
    orderBy: { uploadedAt: 'desc' },
    skip,
    take: limit,
    select: accountFileSelect,
  })
  return {
    files: files.map(({ password, ...file }) => ({
      ...file,
      visibility: password ? 'PROTECTED' : file.visibility,
    })),
    pagination: { total, pages, page, limit },
  }
}
