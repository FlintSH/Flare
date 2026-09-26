import type { Prisma, StorageDeletion } from '@prisma/client'
import { randomUUID } from 'node:crypto'

import { prisma } from '@/lib/database/prisma'
import { mutateAccount } from '@/lib/permissions/account-mutations'
import { PermissionError } from '@/lib/permissions/server'
import { sanitizeFilename, validateStoragePath } from '@/lib/security/paths'

import {
  StorageTargetChangedError,
  getStorageProviderForTarget,
} from './target-provider'
import { parseStorageTarget } from './targets'
import type { StorageTarget } from './targets'
import type { StorageProvider } from './types'

export const STORAGE_DELETION_CONCURRENCY = 4
export const STORAGE_DELETION_LEASE_MS = 120_000
export const STORAGE_DELETION_HEARTBEAT_MS = 30_000
export const STORAGE_DELETION_RETRY_MS = 30_000
export const STORAGE_DELETION_MAX_RETRY_MS = 3_600_000
export const ACCOUNT_DELETION_TRANSACTION_MS = 120_000

/** The caller establishes ownership and commits this with the record mutation. */
export async function queueStorageDeletion(
  tx: Prisma.TransactionClient,
  ownerId: string,
  path: string,
  target: StorageTarget | null
): Promise<void> {
  await tx.storageDeletion.create({
    data: {
      ownerId,
      path: validateStoragePath(path),
      provider: target?.provider ?? 'unknown',
      target: target ?? {},
    },
  })
}

/** Call only inside the account mutation transaction, after authorization locks. */
async function queueAccountStorageDeletion(
  tx: Prisma.TransactionClient,
  userId: string
) {
  // File publication and account mutation share this row lock. Read the paths
  // now, rather than keeping a snapshot from before access was serialized.
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      image: true,
      avatarStoragePath: true,
      avatarStorageTarget: true,
    },
  })
  if (!user) throw new PermissionError('Account not found', 404)
  // Copy directly in PostgreSQL: materializing a large library in JavaScript
  // and issuing hundreds of createMany calls makes account deletion time out.
  // Historical rows have no trustworthy target; retain their paths for recovery.
  await tx.$executeRaw`
    INSERT INTO "StorageDeletion"
      (id, "ownerId", path, provider, target, "updatedAt")
    SELECT gen_random_uuid()::text, "userId", path,
      CASE WHEN "storageTarget"->>'provider' IN ('local', 's3')
        THEN "storageTarget"->>'provider' ELSE 'unknown' END,
      COALESCE("storageTarget", '{}'::jsonb), NOW()
    FROM "File" WHERE "userId" = ${userId}
  `
  await queueAvatarStorageDeletion(tx, user)
}

export async function queueAvatarStorageDeletion(
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
    user.image === `/api/avatars/${ownAvatar}` ||
    ((user.image?.startsWith('https://') ||
      user.image?.startsWith('http://')) &&
      URL.canParse(user.image) &&
      new URL(user.image).pathname.endsWith(`/avatars/${ownAvatar}`))
  const avatarPath =
    user.avatarStoragePath ??
    (legacyLocal
      ? `public/avatars/${ownAvatar}`
      : legacyCurrent
        ? `uploads/avatars/${ownAvatar}`
        : null)
  if (avatarPath) {
    const target =
      parseStorageTarget(user.avatarStorageTarget) ??
      (legacyLocal ? { provider: 'local' as const } : null)
    await queueStorageDeletion(tx, user.id, avatarPath, target)
  }
}

/** The queue and cascades commit together; recovery rejection rolls both back. */
export async function deleteAccountWithStorageCleanup(
  actorId: string,
  targetId: string,
  permission: 'profile.update' | 'users.delete',
  self = false
) {
  await mutateAccount(
    actorId,
    targetId,
    permission,
    async (tx) => {
      await queueAccountStorageDeletion(tx, targetId)
      await tx.user.delete({ where: { id: targetId } })
    },
    self,
    { timeout: ACCOUNT_DELETION_TRANSACTION_MS }
  )
}

/** Global slots and atomic leases allow every app process to run the worker. */
export async function claimStorageDeletions(): Promise<StorageDeletion[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(712347205)`
    const now = new Date()
    const active = await tx.storageDeletion.count({
      where: { status: 'processing', leaseUntil: { gt: now } },
    })
    const slots = Math.max(0, STORAGE_DELETION_CONCURRENCY - active)
    if (!slots) return []
    const leaseId = randomUUID()
    const leaseUntil = new Date(now.getTime() + STORAGE_DELETION_LEASE_MS)
    return tx.$queryRaw<StorageDeletion[]>`
      WITH candidates AS (
        SELECT id FROM "StorageDeletion"
        WHERE "writePending" = false AND (
          (status = 'pending' AND "availableAt" <= ${now})
          OR (status = 'processing' AND "leaseUntil" <= ${now})
        )
        ORDER BY "availableAt", "createdAt", id
        LIMIT ${slots}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "StorageDeletion" AS job
      SET status = 'processing', attempts = attempts + 1,
        "leaseId" = ${leaseId}, "leaseUntil" = ${leaseUntil}, "updatedAt" = ${now}
      FROM candidates WHERE job.id = candidates.id
      RETURNING job.*
    `
  })
}

class StorageTargetUnknown extends Error {}

async function deletionProvider(
  job: StorageDeletion
): Promise<StorageProvider> {
  if (job.provider === 'unknown') throw new StorageTargetUnknown()
  // Read credentials fresh. Never use the cached provider or its local fallback:
  // a configuration change must not delete an identical key in another bucket.
  const target = parseStorageTarget(job.target)
  if (!target || target.provider !== job.provider)
    throw new StorageTargetUnknown()
  return getStorageProviderForTarget(target)
}

function leaseWhere(job: StorageDeletion) {
  return {
    id: job.id,
    status: 'processing',
    leaseId: job.leaseId,
    writePending: false,
    leaseUntil: { gt: new Date() },
  }
}

async function renewLease(job: StorageDeletion): Promise<boolean> {
  const renewed = await prisma.storageDeletion.updateMany({
    where: leaseWhere(job),
    data: { leaseUntil: new Date(Date.now() + STORAGE_DELETION_LEASE_MS) },
  })
  return renewed.count === 1
}

function missingObject(error: unknown): boolean {
  const code =
    (error as { code?: string; name?: string } | null)?.code ||
    (error as Error | null)?.name
  // NoSuchBucket and an arbitrary HTTP 404 are intentionally not success.
  return ['ENOENT', 'NoSuchKey', 'NotFound'].includes(code ?? '')
}

/** Storage I/O runs outside transactions; only the current lease may acknowledge. */
export async function processStorageDeletion(
  job: StorageDeletion
): Promise<boolean> {
  if (job.writePending || !job.leaseId || !(await renewLease(job))) return false
  let heartbeatBusy = false
  const heartbeat = setInterval(() => {
    if (heartbeatBusy) return
    heartbeatBusy = true
    void renewLease(job)
      .catch(() => false)
      .finally(() => {
        heartbeatBusy = false
      })
  }, STORAGE_DELETION_HEARTBEAT_MS)
  heartbeat.unref()
  try {
    validateStoragePath(job.path)
    const storage = await deletionProvider(job)
    if (!(await renewLease(job))) return false
    try {
      await storage.deleteFile(job.path)
    } catch (error) {
      if (!missingObject(error)) throw error
    }
    const completed = await prisma.storageDeletion.deleteMany({
      where: leaseWhere(job),
    })
    return completed.count === 1
  } catch (error) {
    const delay = Math.min(
      STORAGE_DELETION_MAX_RETRY_MS,
      STORAGE_DELETION_RETRY_MS *
        2 ** Math.min(16, Math.max(0, job.attempts - 1))
    )
    await prisma.storageDeletion.updateMany({
      where: leaseWhere(job),
      data: {
        status: 'pending',
        availableAt: new Date(Date.now() + delay),
        leaseId: null,
        leaseUntil: null,
        lastError:
          error instanceof StorageTargetUnknown
            ? 'Storage provenance is unknown; verify the original object location before assigning a cleanup target.'
            : error instanceof StorageTargetChangedError
              ? 'Storage target changed; restore matching S3 bucket, region, endpoint and path style to resume cleanup.'
              : 'Storage deletion failed; retrying. Check storage credentials, connectivity and permissions.',
      },
    })
    return false
  } finally {
    clearInterval(heartbeat)
  }
}
