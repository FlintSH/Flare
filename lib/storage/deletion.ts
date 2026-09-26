import type { Prisma, StorageDeletion } from '@prisma/client'
import { randomUUID } from 'node:crypto'

import { DEFAULT_CONFIG, configSchema } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { mutateAccount } from '@/lib/permissions/account-mutations'
import { PermissionError } from '@/lib/permissions/server'
import { sanitizeFilename, validateStoragePath } from '@/lib/security/paths'

import { LocalStorageProvider } from './providers/local'
import { S3StorageProvider } from './providers/s3'
import type { StorageProvider } from './types'

export const STORAGE_DELETION_CONCURRENCY = 4
export const STORAGE_DELETION_LEASE_MS = 120_000
export const STORAGE_DELETION_HEARTBEAT_MS = 30_000
export const STORAGE_DELETION_RETRY_MS = 30_000
export const STORAGE_DELETION_MAX_RETRY_MS = 3_600_000

function s3Identity(s3: {
  bucket: string
  region: string
  endpoint?: string
  forcePathStyle?: boolean
}) {
  return {
    bucket: s3.bucket,
    region: s3.region,
    endpoint: s3.endpoint ?? '',
    forcePathStyle: s3.forcePathStyle ?? false,
  }
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
    select: { image: true },
  })
  if (!user) throw new PermissionError('Account not found', 404)
  const row = await tx.config.findUnique({ where: { key: 'flare_config' } })
  const { provider, s3 } = configSchema.parse(row?.value ?? DEFAULT_CONFIG)
    .settings.general.storage
  const target = provider === 's3' ? s3Identity(s3) : {}
  const files = await tx.file.findMany({
    where: { userId },
    select: { path: true },
  })
  const paths = new Set(files.map((file) => validateStoragePath(file.path)))
  // Uploaded avatars use this own-account key even when image stores a public
  // S3 URL. Never turn an editable external/image URL into an arbitrary key.
  const ownAvatar = sanitizeFilename(`${userId}.jpg`)
  paths.add(`uploads/avatars/${ownAvatar}`)
  const jobs = [...paths].map((path) => ({
    ownerId: userId,
    path,
    provider,
    target,
  }))
  if (user.image === `/avatars/${ownAvatar}`) {
    jobs.push({
      ownerId: userId,
      path: `public/avatars/${ownAvatar}`,
      provider: 'local',
      target: {},
    })
  }
  // Bound individual SQL statements for accounts with large file libraries.
  for (let offset = 0; offset < jobs.length; offset += 500) {
    await tx.storageDeletion.createMany({
      data: jobs.slice(offset, offset + 500),
    })
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
    self
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
        WHERE (status = 'pending' AND "availableAt" <= ${now})
          OR (status = 'processing' AND "leaseUntil" <= ${now})
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

class StorageTargetChanged extends Error {}

async function deletionProvider(
  job: StorageDeletion
): Promise<StorageProvider> {
  if (job.provider === 'local') return new LocalStorageProvider()
  if (job.provider !== 's3') throw new StorageTargetChanged()
  // Read credentials fresh. Never use the cached provider or its local fallback:
  // a configuration change must not delete an identical key in another bucket.
  const row = await prisma.config.findUnique({ where: { key: 'flare_config' } })
  const s3 = configSchema.parse(row?.value ?? DEFAULT_CONFIG).settings.general
    .storage.s3
  const current = s3Identity(s3)
  const target = job.target as Record<string, unknown>
  if (Object.entries(current).some(([key, value]) => target?.[key] !== value))
    throw new StorageTargetChanged()
  return new S3StorageProvider({ ...s3, endpoint: s3.endpoint || undefined })
}

function leaseWhere(job: StorageDeletion) {
  return {
    id: job.id,
    status: 'processing',
    leaseId: job.leaseId,
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
  if (!job.leaseId || !(await renewLease(job))) return false
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
          error instanceof StorageTargetChanged
            ? 'Storage target changed; restore matching S3 bucket, region, endpoint and path style to resume cleanup.'
            : 'Storage deletion failed; retrying. Check storage credentials, connectivity and permissions.',
      },
    })
    return false
  } finally {
    clearInterval(heartbeat)
  }
}
