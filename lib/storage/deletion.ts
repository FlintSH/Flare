import type { Prisma, StorageDeletion } from '@prisma/client'
import { randomUUID } from 'node:crypto'

import { recordAudit } from '@/lib/audit'
import { lockStorageDeletionClaims } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { validateStoragePath } from '@/lib/security/paths'

import { isMissingObject } from './missing'
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

/**
 * Queues the bytes of every file an account owns, in the transaction that
 * deletes the account; the caller holds the account's row lock.
 */
export async function queueAccountFileDeletions(
  tx: Prisma.TransactionClient,
  userId: string
) {
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
}

/** Global slots and atomic leases allow every app process to run the worker. */
export async function claimStorageDeletions(): Promise<StorageDeletion[]> {
  return prisma.$transaction(async (tx) => {
    await lockStorageDeletionClaims(tx)
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
  // The job's recorded target, never whatever storage is active now: after a
  // storage change, an identical key in another bucket must not be deleted.
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
      if (!isMissingObject(error)) throw error
    }
    const completed = await prisma.storageDeletion.deleteMany({
      where: leaseWhere(job),
    })
    if (completed.count === 1)
      await recordAudit({
        action: 'storage.deleted',
        category: 'storage',
        actorName: 'System',
        targetType: 'StorageDeletion',
        targetId: job.id,
        details: {
          ownerId: job.ownerId,
          provider: job.provider,
          attempts: job.attempts,
        },
      })
    return completed.count === 1
  } catch (error) {
    await recordAudit({
      action: 'storage.delete_failed',
      category: 'storage',
      outcome: 'failure',
      actorName: 'System',
      targetType: 'StorageDeletion',
      targetId: job.id,
      details: {
        ownerId: job.ownerId,
        provider: job.provider,
        attempts: job.attempts,
        reason:
          error instanceof StorageTargetUnknown
            ? 'Unknown storage provenance'
            : error instanceof StorageTargetChangedError
              ? 'Storage target changed'
              : 'Storage deletion failed; retry scheduled',
      },
    })
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
