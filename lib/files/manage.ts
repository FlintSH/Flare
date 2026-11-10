import type { FileVisibility, Prisma } from '@prisma/client'
import { z } from 'zod'

import { recordAudit, setAuditTarget } from '@/lib/audit'
import { prisma } from '@/lib/database/prisma'
import { HttpError } from '@/lib/http/errors'
import { pageWindow } from '@/lib/http/pagination'
import { loggers } from '@/lib/logger'
import { getStorageProvider } from '@/lib/storage'

import {
  auditFileName,
  parsePasswordStanza,
  passwordStanzaSchema,
} from './encrypted'
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

/** An empty or null password removes protection. */
export const fileSettingsSchema = z.object({
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  password: newFilePasswordSchema.nullable().optional(),
  /**
   * For an encrypted file: a new password stanza, base64url with its
   * `record_version` byte, or null to remove it. The client makes it; the
   * server never gets the password (docs/e2ee-spec.md, section 8.2).
   */
  passwordStanza: passwordStanzaSchema,
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
  encrypted: true,
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
  encrypted: true,
  passwordStanza: true,
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

/** Answers the whole stored file with `hasPassword` in place of the password hash. */
export async function updateFileSettings(
  authority: FileAuthority,
  id: string,
  { visibility, password, passwordStanza }: FileSettings
) {
  const where = fileWhere(authority, id)
  const current = await findManagedFile(authority, where)
  const data: Prisma.FileUpdateInput = {}
  if (visibility) data.visibility = visibility
  if (current.encrypted) {
    // A moderator can restrict an encrypted file and cannot publish it. The
    // owner's browser gives a public file in a folder to everyone who has
    // the folder link (docs/e2ee-spec.md, sections 8.4.3 and 9.4.7), so the
    // choice to publish is the owner's only (section 13, requirement 4).
    if (authority.as === 'moderator' && visibility === 'PUBLIC')
      throw new HttpError(
        403,
        'Only the owner can make an encrypted file public.'
      )
    // The server checks no password for an encrypted file. Its password is
    // a stanza that only the owner's client can make.
    if (password !== undefined)
      throw new HttpError(
        400,
        'An encrypted file takes a password stanza, not a server password.'
      )
    if (passwordStanza !== undefined) {
      if (authority.as !== 'owner')
        throw new HttpError(
          403,
          'Only the owner can change the password of an encrypted file.'
        )
      data.passwordStanza = passwordStanza
        ? parsePasswordStanza(passwordStanza)
        : null
    }
  } else {
    if (passwordStanza !== undefined)
      throw new HttpError(400, 'A plain file takes no password stanza.')
    if (password !== undefined) data.password = await hashFilePassword(password)
  }
  const {
    password: passwordHash,
    header: _header,
    sealedMetadata: _sealedMetadata,
    accountStanza: _accountStanza,
    stanzaAccountPublicKey: _stanzaAccountPublicKey,
    passwordStanza: storedStanza,
    folderStanza: _folderStanza,
    folderStanzaPublicKey: _folderStanzaPublicKey,
    ...file
  } = await prisma.file.update({
    where,
    data,
  })
  return {
    ...file,
    hasPassword: Boolean(passwordHash) || Boolean(storedStanza),
  }
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
  const name = auditFileName(file)
  setAuditTarget({ type: 'file', id: file.id, name })
  try {
    const storage = await getStorageProvider()
    await storage.deleteFile(file.path)
    await recordAudit({
      action: 'storage.deleted',
      category: 'storage',
      targetType: 'file',
      targetId: file.id,
      targetName: name,
    })
  } catch (error) {
    await recordAudit({
      action: 'storage.delete_failed',
      category: 'storage',
      outcome: 'failure',
      targetType: 'file',
      targetId: file.id,
      targetName: name,
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
  'password' | 'passwordStanza' | 'visibility' | 'uploadedAt'
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
    files: files.map(({ password, passwordStanza, ...file }) => ({
      ...file,
      visibility: password || passwordStanza ? 'PROTECTED' : file.visibility,
    })),
    pagination: { total, pages, page, limit },
  }
}
