import { ExpiryAction } from '@/types/events'
import type { Event, Prisma } from '@prisma/client'

import { recordAudit } from '@/lib/audit'
import { lockUserRow } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { HttpError } from '@/lib/http/errors'
import { createLogger } from '@/lib/logger'
import { EXPIRY_EFFECTS, allows } from '@/lib/permissions/actions'
import type { PermissionSubject } from '@/lib/permissions/catalog'
import { getStorageProvider } from '@/lib/storage'
import { isMissingObject } from '@/lib/storage/missing'
import { isoDateTimeWithOffset } from '@/lib/utils/iso-datetime'

import { recordedExpiry } from './expiry-notice'

const logger = createLogger('file-expiry')

// Expiry jobs are rows of the Event table. Versions before #199 wrote
// `file.expired` rows, and an upgraded database can still hold some.
const JOB_TYPES = ['file.schedule-expiration', 'file.expired']
const ACTIVE = ['SCHEDULED', 'PENDING', 'PROCESSING'] as const
const BATCH = 10
// A claim this old belongs to a stopped process.
const LEASE_MS = 5 * 60_000
// The wait before the next attempt, by how many times the job has failed.
const RETRY_WAITS: [Prisma.EventWhereInput['retryCount'], number][] = [
  [{ lte: 1 }, 60_000],
  [2, 300_000],
  [{ gte: 3 }, 1_800_000],
]
const RETENTION_MS = 30 * 86_400_000
const PRUNE_BATCH = 10_000

export type FileExpiry = { expiresAt: Date; action: ExpiryAction }

export function isExpiryAction(value: unknown): value is ExpiryAction {
  return Object.values<unknown>(ExpiryAction).includes(value)
}

/** The expiry a request asks for, or null without a time. */
export function fileExpiry(
  expiresAt: string | Date | null | undefined,
  action: unknown
): FileExpiry | null {
  if (!expiresAt) return null
  const instant = new Date(expiresAt)
  if (Number.isNaN(instant.getTime()) || !isExpiryAction(action))
    throw new Error('Invalid file expiration.')
  return { expiresAt: instant, action }
}

/** The fields of a file's `uploadOptions` that record its expiry. */
export function storedExpiry(expiry: FileExpiry | null) {
  return expiry
    ? { expiresAt: expiry.expiresAt.toISOString(), expiryAction: expiry.action }
    : { expiresAt: null }
}

function jsonObject(value: Prisma.JsonValue): Prisma.JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {}
}

// False once the owner cancelled or replaced the expiry, or it was applied.
function stillScheduled(options: Prisma.JsonObject, job: Event): boolean {
  if (options.lastAppliedExpiryEvent === job.id) return false
  // Files uploaded before upload options were recorded have nothing to compare.
  if (!('expiresAt' in options)) return true
  const recorded = recordedExpiry(options)
  return recorded !== null && recorded.getTime() === job.scheduledAt?.getTime()
}

const jobFor = (fileId: string) => ({ path: ['fileId'], equals: fileId })

/**
 * Queue the job that applies `expiry` to `file`, in the caller's transaction.
 * The file's `uploadOptions` must already hold `storedExpiry(expiry)`.
 */
export async function queueFileExpiration(
  tx: Prisma.TransactionClient,
  file: { id: string; userId: string; name: string },
  expiry: FileExpiry
): Promise<void> {
  await tx.event.create({
    data: {
      type: 'file.schedule-expiration',
      status: 'SCHEDULED',
      scheduledAt: expiry.expiresAt,
      payload: {
        fileId: file.id,
        userId: file.userId,
        fileName: file.name,
        expiresAt: expiry.expiresAt.toISOString(),
        action: expiry.action,
      },
    },
  })
  await recordAudit({
    action: 'file.expiration.scheduled',
    category: 'files',
    targetType: 'file',
    targetId: file.id,
    targetName: file.name,
    details: {
      ownerId: file.userId,
      expiresAt: expiry.expiresAt,
      expiryAction: expiry.action,
    },
  })
}

async function clearSchedules(tx: Prisma.TransactionClient, fileId: string) {
  const where = { type: { in: JOB_TYPES }, payload: jobFor(fileId) }
  const pending = await tx.event.deleteMany({
    where: { ...where, status: { in: ['SCHEDULED', 'PENDING'] } },
  })
  // A poller still owns claimed jobs. Completing them lets one waiting for the
  // owner's lock observe the cancellation without a missing-row race.
  const processing = await tx.event.updateMany({
    where: { ...where, status: 'PROCESSING' },
    data: { status: 'COMPLETED', processedAt: new Date() },
  })
  return pending.count + processing.count
}

async function ownedFile(
  db: Pick<Prisma.TransactionClient, 'file'>,
  userId: string,
  fileId: string
) {
  const file = await db.file.findFirst({ where: { id: fileId, userId } })
  if (!file) throw new HttpError(404, 'File not found')
  return file
}

/** An owned file's earliest pending expiry, or null when none is pending. */
export async function pendingExpiration(
  userId: string,
  fileId: string
): Promise<Date | null> {
  await ownedFile(prisma, userId, fileId)
  return (await getFilesExpirationInfo([fileId])).get(fileId)?.expiresAt ?? null
}

/**
 * Replace an owned file's expiry with the one `request` asks for: a future
 * time in the ISO 8601 form uploads take, with `Z` or an offset, and an action,
 * deletion unless it names another. The action also needs the permission of
 * what it does.
 */
export async function scheduleFileExpiration(
  owner: PermissionSubject & { id: string },
  fileId: string,
  request: unknown
): Promise<Date> {
  const { expiresAt, action = ExpiryAction.DELETE } = (request ?? {}) as {
    expiresAt?: unknown
    action?: unknown
  }
  if (!expiresAt) throw new HttpError(400, 'Expiration date is required')
  if (!isoDateTimeWithOffset.safeParse(expiresAt).success)
    throw new HttpError(
      400,
      'Invalid expiration date. Use an ISO 8601 timestamp with a timezone.'
    )
  const instant = new Date(expiresAt as string)
  if (instant <= new Date())
    throw new HttpError(400, 'Invalid expiration date. Must be in the future.')
  await prisma.$transaction(async (tx) => {
    await lockUserRow(tx, owner.id)
    const file = await ownedFile(tx, owner.id, fileId)
    if (!isExpiryAction(action))
      throw new HttpError(400, 'Invalid expiration action')
    if (!allows(owner, EXPIRY_EFFECTS[action]))
      throw new HttpError(
        403,
        'You do not have permission for this expiration action.'
      )
    const expiry = { expiresAt: instant, action }
    await clearSchedules(tx, fileId)
    await tx.file.update({
      where: { id: fileId },
      data: {
        uploadOptions: {
          ...jsonObject(file.uploadOptions),
          ...storedExpiry(expiry),
        },
      },
    })
    await queueFileExpiration(tx, file, expiry)
  })
  return instant
}

/** Remove an owned file's pending expiry; false when none was pending. */
export async function cancelFileExpiration(
  userId: string,
  fileId: string
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await lockUserRow(tx, userId)
    const file = await ownedFile(tx, userId, fileId)
    const count = await clearSchedules(tx, fileId)
    const options = jsonObject(file.uploadOptions)
    await tx.file.updateMany({
      where: { id: fileId },
      data: { uploadOptions: { ...options, ...storedExpiry(null) } },
    })
    if (count > 0)
      await recordAudit({
        action: 'file.expiration.cancelled',
        category: 'files',
        targetType: 'file',
        targetId: file.id,
        targetName: file.name,
        details: {
          ownerId: file.userId,
          count,
          expiresAt: recordedExpiry(options) ?? undefined,
          expiryAction: isExpiryAction(options.expiryAction)
            ? options.expiryAction
            : undefined,
        },
      })
    return count > 0
  })
}

/**
 * Each file's earliest pending expiry and what it does, for a page of files in
 * one query; null for a job without a time.
 */
export async function getFilesExpirationInfo(
  fileIds: string[]
): Promise<Map<string, FileExpiry | null>> {
  const expirations = new Map<string, FileExpiry | null>()
  if (!fileIds.length) return expirations
  // One indexed probe for each file, where a JSON filter for each file made
  // PostgreSQL compare every pending job with every file on the page.
  const rows = await prisma.$queryRaw<
    { payload: Prisma.JsonValue; scheduledAt: Date | null }[]
  >`
    SELECT payload, "scheduledAt" FROM "Event"
    WHERE payload ->> 'fileId' = ANY(${fileIds})
      AND jsonb_typeof(payload -> 'fileId') = 'string'
      AND type = ANY(${JOB_TYPES})
      AND status::text = ANY(${[...ACTIVE]})
    ORDER BY "scheduledAt" ASC
  `
  for (const row of rows) {
    const { fileId, action } = jsonObject(row.payload)
    if (typeof fileId === 'string' && !expirations.has(fileId))
      expirations.set(
        fileId,
        row.scheduledAt && {
          expiresAt: row.scheduledAt,
          // Every job records its action; deletion is the scheduling default.
          action: isExpiryAction(action) ? action : ExpiryAction.DELETE,
        }
      )
  }
  return expirations
}

/**
 * Apply one job unless it was cancelled, replaced or already applied. Safe to
 * repeat: a retry, an expired claim or an older version can deliver it twice.
 */
export async function applyFileExpiration(
  job: Pick<Event, 'id' | 'payload'>
): Promise<void> {
  const { fileId, userId, action } = jsonObject(job.payload)
  if (typeof fileId !== 'string' || typeof userId !== 'string')
    throw new Error('Invalid file expiration.')
  // Lazy provider initialization reads config; resolve before consuming the
  // transaction connection so a cold worker also supports a one-connection pool.
  const storage =
    action === ExpiryAction.DELETE ? await getStorageProvider() : null
  await prisma.$transaction(
    async (tx) => {
      // Serializes deliveries with each other, quota changes and cancellation.
      await lockUserRow(tx, userId)
      const current = await tx.event.findUnique({ where: { id: job.id } })
      if (!current || current.status === 'COMPLETED') return
      const file = await tx.file.findUnique({ where: { id: fileId } })
      const options = jsonObject(file?.uploadOptions ?? null)
      if (file?.userId === userId && stillScheduled(options, current)) {
        if (action === ExpiryAction.DELETE) {
          try {
            await storage!.deleteFile(file.path)
          } catch (error) {
            if (!isMissingObject(error)) throw error
          }
          await tx.file.delete({ where: { id: file.id } })
          await tx.user.update({
            where: { id: file.userId },
            data: { storageUsed: { decrement: file.size } },
          })
        } else if (action === ExpiryAction.SET_PRIVATE) {
          await tx.file.update({
            where: { id: file.id },
            data: {
              visibility: 'PRIVATE',
              uploadOptions: { ...options, lastAppliedExpiryEvent: current.id },
            },
          })
        } else throw new Error('Invalid file expiration action.')
        await recordAudit({
          action: 'file.expiration.applied',
          category: 'files',
          actorId: null,
          actorName: 'System',
          targetType: 'file',
          targetId: file.id,
          targetName: file.name,
          details: {
            ownerId: file.userId,
            eventId: current.id,
            expiresAt: current.scheduledAt,
            expiryAction: action,
          },
        })
        logger.info('File expiration applied', { fileId: file.id, action })
      }
      await tx.event.update({
        where: { id: current.id },
        data: { status: 'COMPLETED', processedAt: new Date() },
      })
    },
    { timeout: 15000 }
  )
}

function dueJobs(now: number): Prisma.EventWhereInput {
  return {
    type: { in: JOB_TYPES },
    OR: [
      {
        status: { in: ['SCHEDULED', 'PENDING'] },
        AND: [
          {
            OR: [
              { scheduledAt: null },
              { scheduledAt: { lte: new Date(now) } },
            ],
          },
          {
            OR: [
              { failedAt: null },
              ...RETRY_WAITS.map(([retryCount, wait]) => ({
                retryCount,
                failedAt: { lte: new Date(now - wait) },
              })),
            ],
          },
        ],
      },
      { status: 'PROCESSING', updatedAt: { lte: new Date(now - LEASE_MS) } },
    ],
  }
}

// Compare-and-set against the row as read: a process holding an older snapshot
// claims nothing, so two processes never run the same attempt. The claim time
// comes from the clock `dueJobs` uses to decide the claim was abandoned.
async function claim(job: Event): Promise<boolean> {
  const { count } = await prisma.event.updateMany({
    where: { id: job.id, status: job.status, updatedAt: job.updatedAt },
    data: { status: 'PROCESSING', updatedAt: new Date() },
  })
  return count === 1
}

async function recordFailure(job: Event, error: unknown) {
  const retry = job.retryCount < job.maxRetries
  const failure = {
    failedAt: new Date(),
    error: error instanceof Error ? error.message : 'Unknown error',
  }
  try {
    // A job cancelled meanwhile stays cancelled.
    await prisma.event.updateMany({
      where: { id: job.id, status: 'PROCESSING' },
      data: retry
        ? { ...failure, status: 'PENDING', retryCount: { increment: 1 } }
        : { ...failure, status: 'FAILED' },
    })
  } catch {
    logger.warn('File expiration failed; its claim will be retried.', {
      eventId: job.id,
    })
    return { reason: 'Event processing failed' }
  }
  logger.warn(
    retry
      ? 'File expiration failed; it will be retried.'
      : 'File expiration failed after its last retry.',
    { eventId: job.id }
  )
  return { eventType: job.type, retry }
}

export async function processDueExpirations(): Promise<void> {
  const due = await prisma.event.findMany({
    where: dueJobs(Date.now()),
    orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
    take: BATCH,
  })
  for (const job of due) {
    if (!(await claim(job))) continue
    let failure: Record<string, unknown> | null = null
    try {
      await applyFileExpiration(job)
    } catch (error) {
      failure = await recordFailure(job, error)
    }
    await recordAudit({
      action: failure ? 'event.failed' : 'event.completed',
      category: 'system',
      outcome: failure ? 'failure' : 'success',
      actorName: 'System',
      targetType: 'Event',
      targetId: job.id,
      details: failure ?? { eventType: job.type },
    })
  }
}

/** Delete jobs 30 days after they finish; true when more may remain. */
export async function pruneFinishedExpirations(): Promise<boolean> {
  const { count } = await prisma.event.deleteMany({
    where: {
      type: { in: JOB_TYPES },
      status: { in: ['COMPLETED', 'FAILED'] },
      updatedAt: { lt: new Date(Date.now() - RETENTION_MS) },
    },
    limit: PRUNE_BATCH,
  })
  return count === PRUNE_BATCH
}
