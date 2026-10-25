import type { PrismaClient } from '@prisma/client'

import { recordAudit } from '@/lib/audit'
import { auditContext } from '@/lib/audit/context'
import { prisma } from '@/lib/database/prisma'
import { createLogger } from '@/lib/logger'

const logger = createLogger('audit-retention')

// Retention is an operator setting on purpose. Anyone who can change instance
// settings could otherwise shorten it to remove evidence of their own actions.
const MAX_RETENTION_DAYS = 36_500
/** Rows deleted per transaction, oldest first along the (createdAt, id) index. */
export const AUDIT_RETENTION_BATCH_SIZE = 5_000
/** Batches per run. A larger backlog continues on a follow-up run. */
export const AUDIT_RETENTION_MAX_BATCHES = 100
const FIRST_RUN_DELAY_MS = 60_000
const RUN_INTERVAL_MS = 60 * 60_000
const BACKLOG_DELAY_MS = 60_000

export type AuditRetentionSetting =
  { days: number; error?: undefined } | { days: null; error?: string }

/** Parse FLARE_AUDIT_RETENTION_DAYS. Unset, empty, or 0 keeps every event. */
export function auditRetentionSetting(
  value: string | undefined
): AuditRetentionSetting {
  const raw = value?.trim() ?? ''
  if (raw === '' || /^0+$/.test(raw)) return { days: null }
  const days = /^\d+$/.test(raw) ? Number(raw) : NaN
  if (!Number.isSafeInteger(days) || days > MAX_RETENTION_DAYS)
    return {
      days: null,
      error: `FLARE_AUDIT_RETENTION_DAYS must be a whole number of days from 1 to ${MAX_RETENTION_DAYS}, or 0 to keep every audit event. Audit events are kept until it is corrected.`,
    }
  return { days }
}

export type AuditPruneResult = {
  cutoff: Date
  deleted: number
  /** No events older than the cutoff were left when the run ended. */
  complete: boolean
  /** Another process was pruning, so this run stopped and left the rest to it. */
  contended: boolean
}

/**
 * Delete audit events older than `days`, in bounded batches. Each batch is
 * its own short transaction holding an advisory lock, so only one process
 * deletes at a time and a large backlog never holds one long transaction.
 * A run that deletes anything records one system event saying so.
 */
export async function pruneAuditEvents(
  days: number,
  {
    client = prisma,
    now = new Date(),
    batchSize = AUDIT_RETENTION_BATCH_SIZE,
    maxBatches = AUDIT_RETENTION_MAX_BATCHES,
  }: {
    client?: PrismaClient
    now?: Date
    batchSize?: number
    maxBatches?: number
  } = {}
): Promise<AuditPruneResult> {
  const cutoff = new Date(now.getTime() - days * 86_400_000)
  let deleted = 0
  let complete = false
  let contended = false
  let failure: unknown = null
  try {
    for (let batch = 0; batch < maxBatches; batch++) {
      const removed = await client.$transaction(
        async (tx) => {
          const [{ locked }] = await tx.$queryRaw<Array<{ locked: boolean }>>`
          SELECT pg_try_advisory_xact_lock(712347214) AS "locked"
        `
          if (!locked) return null
          // AuditEvent is not an audited model, so these writes add no events.
          const expired = await tx.auditEvent.findMany({
            where: { createdAt: { lt: cutoff } },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: batchSize,
            select: { id: true },
          })
          if (!expired.length) return 0
          const { count } = await tx.auditEvent.deleteMany({
            where: { id: { in: expired.map((event) => event.id) } },
          })
          return count
        },
        { maxWait: 10_000, timeout: 60_000 }
      )
      if (removed === null) {
        contended = true
        break
      }
      deleted += removed
      if (removed < batchSize) {
        complete = true
        break
      }
    }
  } catch (error) {
    // Earlier batches are already committed; still say how many were removed.
    failure = error
    complete = false
  }
  if (deleted > 0)
    await recordAudit({
      action: 'audit.retention.applied',
      category: 'system',
      actorId: null,
      actorName: 'System',
      details: {
        retentionDays: days,
        cutoff: cutoff.toISOString(),
        count: deleted,
        complete,
      },
    })
  if (failure) throw failure
  return { cutoff, deleted, complete, contended }
}

const state = globalThis as typeof globalThis & {
  flareAuditRetention?: { timer: NodeJS.Timeout; busy: boolean }
}

/**
 * Prune once shortly after startup and then hourly, when the operator set
 * FLARE_AUDIT_RETENTION_DAYS. Without it, nothing is scheduled.
 */
export function startAuditRetentionWorker(
  value = process.env.FLARE_AUDIT_RETENTION_DAYS,
  {
    prune = pruneAuditEvents,
  }: { prune?: (days: number) => Promise<AuditPruneResult> } = {}
): AuditRetentionSetting {
  const setting = auditRetentionSetting(value)
  if (setting.error) logger.error(setting.error)
  const { days } = setting
  if (days === null || state.flareAuditRetention) return setting

  const run = () =>
    auditContext.run({ actorId: null, actorName: 'System' }, async () => {
      const worker = state.flareAuditRetention
      if (!worker || worker.busy) return
      worker.busy = true
      try {
        const result = await prune(days)
        if (result.deleted)
          logger.info('Deleted audit events past the retention period', {
            deleted: result.deleted,
            cutoff: result.cutoff.toISOString(),
          })
        // A large backlog continues soon instead of waiting an hour.
        if (!result.complete && !result.contended)
          setTimeout(run, BACKLOG_DELAY_MS).unref()
      } catch {
        logger.warn('Audit retention unavailable; retrying on the next run.')
      } finally {
        worker.busy = false
      }
    })

  logger.info(
    `Audit events older than ${days} days are deleted every hour (FLARE_AUDIT_RETENTION_DAYS)`
  )
  setTimeout(run, FIRST_RUN_DELAY_MS).unref()
  const timer = setInterval(run, RUN_INTERVAL_MS)
  timer.unref()
  state.flareAuditRetention = { timer, busy: false }
  return setting
}
