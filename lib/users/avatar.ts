import { Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'

import { readConfig } from '@/lib/config'
import { lockRoleChanges, lockUserRow } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { mutateAccount } from '@/lib/permissions/account-mutations'
import {
  PermissionError,
  requireActorPermission,
} from '@/lib/permissions/server'
import { sanitizeFilename } from '@/lib/security/paths'
import { getStorageProvider } from '@/lib/storage'
import { AVATAR_MAX_BYTES } from '@/lib/storage/avatar-policy'
import { queueStorageDeletion } from '@/lib/storage/deletion'
import { captureStorageTarget, parseStorageTarget } from '@/lib/storage/targets'
import { assertFits, uploadCapacity } from '@/lib/uploads/capacity'

const logger = loggers.users

// Every avatar upload is stored under its own file name in `uploads/avatars/`
// and served at `/api/avatars/{file name}`, unless storage gives it a public
// address of its own.

function avatarPath(filename: string) {
  return `uploads/avatars/${filename}`
}

function avatarAddress(filename: string) {
  return `/api/avatars/${filename}`
}

/**
 * The stored avatar `/api/avatars/{filename}` names, when an account uses it:
 * its path and the storage target recorded when it was written. `recorded`
 * is false for avatars from before targets were recorded.
 */
export async function findAvatar(filename: string) {
  const path = avatarPath(filename)
  const owner = await prisma.user.findFirst({
    where: {
      OR: [
        { avatarStoragePath: path },
        { avatarStoragePath: null, image: avatarAddress(filename) },
      ],
    },
    select: { avatarStorageTarget: true, avatarStoragePath: true },
  })
  if (!owner) return null
  return {
    path,
    recorded: Boolean(owner.avatarStoragePath),
    target: parseStorageTarget(owner.avatarStorageTarget),
  }
}

/** Queues the bytes of an account's uploaded avatar in the transaction that replaces or drops it. */
export async function queueAvatarDeletion(
  tx: Prisma.TransactionClient,
  user: {
    id: string
    image: string | null
    avatarStoragePath: string | null
    avatarStorageTarget: unknown
  }
): Promise<void> {
  // New avatars retain their exact versioned key, independent of editable image
  // URLs. Legacy app-owned image paths can be retained without guessing S3.
  const ownAvatar = sanitizeFilename(`${user.id}.jpg`)
  const legacyLocal = user.image === `/avatars/${ownAvatar}`
  const legacyCurrent =
    user.image === avatarAddress(ownAvatar) ||
    ((user.image?.startsWith('https://') ||
      user.image?.startsWith('http://')) &&
      URL.canParse(user.image) &&
      new URL(user.image).pathname.endsWith(`/avatars/${ownAvatar}`))
  const path =
    user.avatarStoragePath ??
    (legacyLocal
      ? `public/avatars/${ownAvatar}`
      : legacyCurrent
        ? avatarPath(ownAvatar)
        : null)
  if (path) {
    const target =
      parseStorageTarget(user.avatarStorageTarget) ??
      (legacyLocal ? { provider: 'local' as const } : null)
    await queueStorageDeletion(tx, user.id, path, target)
  }
}

async function authorizeAvatarWrite(
  tx: Prisma.TransactionClient,
  userId: string,
  size: number
) {
  await lockRoleChanges(tx)
  await lockUserRow(tx, userId)
  const user = await tx.user.findUnique({ where: { id: userId } })
  if (!user) throw new PermissionError('Account not found', 404)
  const access = await requireActorPermission(tx, userId, 'profile.update')
  // An avatar has its own size limit, not the instance's upload limit.
  assertFits(
    uploadCapacity(await readConfig(tx), access, user.storageUsed, {
      fileBytes: AVATAR_MAX_BYTES,
    }),
    size
  )
  return user
}

/**
 * Journal the write before touching storage. A pending writer is never eligible
 * for deletion: if this process crashes, an operator must stop writers before
 * releasing its retained intent for cleanup.
 */
export async function uploadAvatar(
  userId: string,
  image: Buffer
): Promise<string> {
  const storage = await getStorageProvider()
  const target = captureStorageTarget(storage)
  const filename = sanitizeFilename(`${userId}-${randomUUID()}.jpg`)
  const path = avatarPath(filename)
  const intent = await prisma.$transaction(async (tx) => {
    await authorizeAvatarWrite(tx, userId, image.length)
    return tx.storageDeletion.create({
      data: {
        ownerId: userId,
        path,
        provider: target.provider,
        target,
        writePending: true,
      },
    })
  })

  try {
    // Network/filesystem I/O intentionally happens outside database locks.
    await storage.uploadFile(image, path, 'image/jpeg')
    const publicUrl = await storage.getPublicUrl(path)
    if (publicUrl && !['http:', 'https:'].includes(new URL(publicUrl).protocol))
      throw new Error('Avatar storage returned an invalid public URL')
    const url = publicUrl || avatarAddress(filename)
    await prisma.$transaction(async (tx) => {
      const user = await authorizeAvatarWrite(tx, userId, image.length)
      const writing = await tx.storageDeletion.findUnique({
        where: { id: intent.id },
      })
      if (!writing?.writePending)
        throw new PermissionError('Avatar upload was cancelled; try again', 409)
      await queueAvatarDeletion(tx, user)
      await tx.user.update({
        where: { id: userId },
        data: {
          image: url,
          avatarStoragePath: path,
          avatarStorageTarget: target,
        },
      })
      await tx.storageDeletion.delete({ where: { id: intent.id } })
    })
    return url
  } catch (error) {
    // uploadFile has settled: a worker can now remove even a partial object.
    // If the database is unavailable, retaining writePending is safer than
    // losing the cleanup record or pretending this object was removed.
    try {
      await prisma.storageDeletion.updateMany({
        where: { id: intent.id, writePending: true },
        data: { writePending: false, availableAt: new Date() },
      })
    } catch (cleanupError) {
      logger.error(
        'Avatar cleanup intent could not be released',
        cleanupError as Error,
        { intentId: intent.id }
      )
    }
    throw error
  }
}

/** An administrator clears an account's avatar; its bytes are queued for deletion. */
export async function removeAvatar(actorId: string, userId: string) {
  await mutateAccount(actorId, userId, 'users.update', async (tx) => {
    await lockUserRow(tx, userId)
    const user = await tx.user.findUnique({ where: { id: userId } })
    if (!user) throw new PermissionError('User not found', 404)
    await queueAvatarDeletion(tx, user)
    await tx.user.update({
      where: { id: userId },
      data: {
        image: null,
        avatarStoragePath: null,
        avatarStorageTarget: Prisma.DbNull,
      },
    })
  })
}
