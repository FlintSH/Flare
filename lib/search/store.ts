import { Prisma, type SearchIndexStatus } from '@prisma/client'
import { randomUUID } from 'node:crypto'

import { prisma } from '@/lib/database/prisma'

import type { SearchIndexState } from './contract'
import type { Extraction } from './extract'
import {
  SEARCH_EXTRACTOR_VERSION,
  SEARCH_INDEX_ATTEMPTS,
  SEARCH_INDEX_LEASE_MS,
  SEARCH_INDEX_RETRY_MS,
} from './limits'
import { recognizedText, tokenize } from './text'

/** Shown for images while automatic OCR is off; cleared when it's turned on. */
export const OCR_OFF_REASON =
  'Automatic text recognition is turned off on this instance.'
/** Shown for documents while document reading is off; cleared when it's turned on. */
export const DOCUMENTS_OFF_REASON =
  'Reading documents for search is turned off on this instance.'

/** Queue a new file. Called in the transaction that publishes it. */
export async function queueSearchIndex(
  transaction: Prisma.TransactionClient,
  file: { id: string; userId: string }
) {
  await transaction.fileSearchIndex.create({
    data: { fileId: file.id, userId: file.userId, availableAt: new Date() },
  })
}

export interface SearchIndexJob {
  fileId: string
  attempts: number
  leaseId: string
}

/**
 * Claim files to read, newest first: new uploads, then the newest of any
 * backlog. Expired leases from a stopped process are claimed again.
 */
export async function claimSearchIndexJobs(
  slots: number
): Promise<SearchIndexJob[]> {
  if (slots <= 0) return []
  const now = new Date()
  const leaseId = randomUUID()
  return prisma.$queryRaw<SearchIndexJob[]>`
    WITH candidates AS (
      -- Each branch reads the (status, availableAt) index instead of sorting
      -- the whole backlog; locked rows are rechecked before they're claimed.
      SELECT "fileId" FROM "FileSearchIndex"
      WHERE "fileId" IN (
        (SELECT "fileId" FROM "FileSearchIndex"
          WHERE status = 'PENDING' AND "availableAt" <= ${now}
          ORDER BY "availableAt" DESC LIMIT ${slots * 4})
        UNION ALL
        (SELECT "fileId" FROM "FileSearchIndex"
          WHERE status = 'PROCESSING' AND "leaseUntil" <= ${now}
          LIMIT ${slots * 4})
      )
      AND ((status = 'PENDING' AND "availableAt" <= ${now})
        OR (status = 'PROCESSING' AND "leaseUntil" <= ${now}))
      ORDER BY "availableAt" DESC
      LIMIT ${slots}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "FileSearchIndex" AS job
    SET status = 'PROCESSING', attempts = job.attempts + 1,
      "leaseId" = ${leaseId},
      "leaseUntil" = ${new Date(now.getTime() + SEARCH_INDEX_LEASE_MS)},
      "updatedAt" = ${now}
    FROM candidates WHERE job."fileId" = candidates."fileId"
    RETURNING job."fileId", job.attempts, job."leaseId"
  `
}

/** Keep a claim while a slow file is still being read. */
export async function renewSearchIndexLease(job: SearchIndexJob) {
  const renewed = await prisma.fileSearchIndex.updateMany({
    where: { fileId: job.fileId, leaseId: job.leaseId, status: 'PROCESSING' },
    data: { leaseUntil: new Date(Date.now() + SEARCH_INDEX_LEASE_MS) },
  })
  return renewed.count === 1
}

function vectorSql(content: string | null, entries: string[] | null) {
  return Prisma.sql`setweight(to_tsvector('simple', ${tokenize(content ?? '').join(' ')}), 'C')
    || setweight(to_tsvector('simple', ${tokenize((entries ?? []).join(' ')).join(' ')}), 'D')`
}

// The database clock, in UTC like Prisma's timestamps, so content matches can
// be bounded by the same snapshot as the library timeline.
const DATABASE_NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')`

function resultSql(extraction: Extraction) {
  if (extraction.status === 'INDEXED')
    return Prisma.sql`status = 'INDEXED', source = ${extraction.source},
      content = ${extraction.content}, entries = ${extraction.entries?.join('\n') ?? null},
      vector = ${vectorSql(extraction.content, extraction.entries)}, reason = NULL`
  return Prisma.sql`status = ${extraction.status}::"SearchIndexStatus",
    source = ${extraction.status === 'UNSUPPORTED' ? null : extraction.source},
    content = NULL, entries = NULL, vector = NULL, reason = ${extraction.reason}`
}

/** Save a result for a claim. False when the claim was lost meanwhile. */
export async function saveExtraction(
  job: SearchIndexJob,
  extraction: Extraction
): Promise<boolean> {
  const updated = await prisma.$executeRaw`
    UPDATE "FileSearchIndex" SET ${resultSql(extraction)},
      version = ${SEARCH_EXTRACTOR_VERSION}, "indexedAt" = ${DATABASE_NOW},
      "leaseId" = NULL, "leaseUntil" = NULL, "updatedAt" = ${new Date()}
    WHERE "fileId" = ${job.fileId} AND "leaseId" = ${job.leaseId}
      AND status = 'PROCESSING'
  `
  return updated === 1
}

/**
 * Try again later, or give up after the last attempt. Text found earlier
 * stays searchable until a new result replaces it.
 */
export async function saveFailure(
  job: SearchIndexJob,
  reason: string,
  retry: boolean
) {
  const again = retry && job.attempts < SEARCH_INDEX_ATTEMPTS
  const delay =
    SEARCH_INDEX_RETRY_MS[
      Math.min(job.attempts - 1, SEARCH_INDEX_RETRY_MS.length - 1)
    ]
  await prisma.fileSearchIndex.updateMany({
    where: { fileId: job.fileId, leaseId: job.leaseId, status: 'PROCESSING' },
    data: again
      ? {
          status: 'PENDING',
          availableAt: new Date(Date.now() + delay),
          reason,
          leaseId: null,
          leaseUntil: null,
        }
      : {
          status: 'FAILED',
          reason,
          version: SEARCH_EXTRACTOR_VERSION,
          leaseId: null,
          leaseUntil: null,
        },
  })
}

/**
 * Text recognized on request, outside the worker. A claim in progress keeps
 * its own result, which reads the same text.
 */
export async function saveRecognizedText(fileId: string, text: string) {
  const content = recognizedText(text).replace(/\s+/g, ' ').trim()
  await prisma.$executeRaw`
    UPDATE "FileSearchIndex" SET ${resultSql(
      content
        ? { status: 'INDEXED', source: 'ocr', content, entries: null }
        : {
            status: 'EMPTY',
            source: 'ocr',
            reason: 'No text was found in this image.',
          }
    )}, version = ${SEARCH_EXTRACTOR_VERSION}, "indexedAt" = ${DATABASE_NOW},
      attempts = 0, "updatedAt" = ${new Date()}
    WHERE "fileId" = ${fileId} AND status <> 'PROCESSING'
  `
}

/**
 * Read files again: rows from an older extractor, and skipped files whose
 * setting has been turned back on. Returns how many were queued. Skipped rows
 * are found through the status index; checking versions reads every row, so
 * workers do that once per process.
 */
export async function requeueOutdated(
  enabled: { ocr: boolean; documents: boolean },
  /** Also look for rows from an older extractor, which reads every row. */
  versions = true
) {
  const reasons = [
    ...(enabled.ocr ? [OCR_OFF_REASON] : []),
    ...(enabled.documents ? [DOCUMENTS_OFF_REASON] : []),
  ]
  const now = new Date()
  const [outdated, unskipped] = await Promise.all([
    versions
      ? prisma.fileSearchIndex.updateMany({
          where: {
            version: { lt: SEARCH_EXTRACTOR_VERSION },
            status: { notIn: ['PENDING', 'PROCESSING'] },
          },
          data: { status: 'PENDING', attempts: 0, availableAt: now },
        })
      : { count: 0 },
    reasons.length
      ? prisma.fileSearchIndex.updateMany({
          where: { status: 'SKIPPED', reason: { in: reasons } },
          data: { status: 'PENDING', attempts: 0, availableAt: now },
        })
      : { count: 0 },
  ])
  return outdated.count + unskipped.count
}

/**
 * Queue an owner's files to be read again: the given files, or every file
 * that failed. Files already waiting or being read are left alone.
 */
export async function requeueSearchIndex(
  userId: string,
  selection: { fileIds: string[] } | { failed: true }
) {
  const result = await prisma.fileSearchIndex.updateMany({
    where:
      'fileIds' in selection
        ? {
            userId,
            fileId: { in: selection.fileIds },
            status: { notIn: ['PENDING', 'PROCESSING'] },
          }
        : { userId, status: 'FAILED' },
    data: { status: 'PENDING', attempts: 0, availableAt: new Date() },
  })
  return result.count
}

/** Status names as the API and filters write them. */
export const SEARCH_INDEX_STATES: Record<SearchIndexStatus, SearchIndexState> =
  {
    PENDING: 'waiting',
    PROCESSING: 'waiting',
    INDEXED: 'indexed',
    EMPTY: 'empty',
    FAILED: 'failed',
    SKIPPED: 'skipped',
    UNSUPPORTED: 'unsupported',
  }

/** How much of an owner's library the index has read. */
export async function searchIndexSummary(
  userId: string
): Promise<{ total: number; counts: Record<SearchIndexState, number> }> {
  const rows = await prisma.fileSearchIndex.groupBy({
    by: ['status'],
    where: { userId },
    _count: { _all: true },
  })
  const counts: Record<SearchIndexState, number> = {
    waiting: 0,
    indexed: 0,
    empty: 0,
    failed: 0,
    skipped: 0,
    unsupported: 0,
  }
  let total = 0
  for (const row of rows) {
    counts[SEARCH_INDEX_STATES[row.status]] += row._count._all
    total += row._count._all
  }
  return { total, counts }
}
