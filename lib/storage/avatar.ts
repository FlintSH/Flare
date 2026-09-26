import type { Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'

import { DEFAULT_CONFIG, configSchema } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { hasPermission } from '@/lib/permissions/catalog'
import {
  PermissionError,
  lockRoleChanges,
  requireActorPermission,
} from '@/lib/permissions/server'
import { sanitizeFilename } from '@/lib/security/paths'
import { bytesToMB } from '@/lib/utils'

import { queueAvatarStorageDeletion } from './deletion'
import { getStorageProvider } from './index'
import { captureStorageTarget } from './targets'

const logger = loggers.users

async function authorizeAvatarWrite(
  tx: Prisma.TransactionClient,
  userId: string,
  size: number
) {
  await lockRoleChanges(tx)
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`
  const user = await tx.user.findUnique({ where: { id: userId } })
  if (!user) throw new PermissionError('Account not found', 404)
  const access = await requireActorPermission(tx, userId, 'profile.update')
  const config = await tx.config.findUnique({ where: { key: 'flare_config' } })
  const { quotas } = configSchema.parse(config?.value ?? DEFAULT_CONFIG)
    .settings.general.storage
  if (quotas.enabled && !hasPermission(access, 'quotas.bypass')) {
    const quotaMB =
      quotas.default.value * (quotas.default.unit === 'GB' ? 1024 : 1)
    if (user.storageUsed + bytesToMB(size) > quotaMB)
      throw new PermissionError('Storage quota exceeded', 413)
  }
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
  const path = `uploads/avatars/${filename}`
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
    const url = publicUrl || `/api/avatars/${filename}`
    await prisma.$transaction(async (tx) => {
      const user = await authorizeAvatarWrite(tx, userId, image.length)
      const writing = await tx.storageDeletion.findUnique({
        where: { id: intent.id },
      })
      if (!writing?.writePending)
        throw new PermissionError('Avatar upload was cancelled; try again', 409)
      await queueAvatarStorageDeletion(tx, user)
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
