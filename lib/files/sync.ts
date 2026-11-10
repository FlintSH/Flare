import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/database/prisma'
import { wireBytes } from '@/lib/library/sealed-fields'

import { getFilesExpirationInfo } from './expiry'
import { fileListItem, fileListSelect } from './gallery-navigation'

/**
 * What the local search cache of the owner's browser reads
 * (docs/e2ee-spec.md, section 9.8.1): the encrypted files of the account
 * with their sealed records, in steps.
 *
 * Every row has a `syncSeq`, which a database trigger moves on when a value
 * changes that the cache keeps. A client asks for the rows after the last
 * `syncSeq` it saw. Deleted files, and rows that were committed out of
 * order, show in the `state` of each answer: the count and the sum of
 * `syncSeq` over the files the account has now. A cache that does not give
 * the same two numbers is repaired from the `index` list.
 *
 * Every value here is ciphertext or a value that the server shows in a list
 * of files anyway. A file that no key of the account opens is left out.
 */

export const SYNC_PAGE_SIZE = 200
export const SYNC_PAGE_MAX = 500
export const SYNC_INDEX_PAGE_SIZE = 5000

const syncSelect = {
  ...fileListSelect,
  syncSeq: true,
  sealedData: { select: { sealedOcrText: true } },
} satisfies Prisma.FileSelect

type SyncRow = Prisma.FileGetPayload<{ select: typeof syncSelect }>

const readable = (userId: string): Prisma.FileWhereInput => ({
  userId,
  encrypted: true,
  unreadable: false,
})

async function records(rows: SyncRow[]) {
  const expirations = await getFilesExpirationInfo(rows.map((row) => row.id))
  return rows.map(({ syncSeq, sealedData, ...row }) => ({
    ...fileListItem(row, expirations.get(row.id) ?? null),
    seq: syncSeq,
    sealedOcrText: wireBytes(sealedData?.sealedOcrText),
  }))
}

export type SyncRecord = Awaited<ReturnType<typeof records>>[number]

export interface SyncState {
  count: number
  /** The sum of `seq` over the encrypted files, as text: it can pass 2^53. */
  sum: string
}

async function syncState(userId: string): Promise<SyncState> {
  const [state] = await prisma.$queryRaw<{ count: bigint; sum: bigint }[]>`
    SELECT COUNT(*) AS count, COALESCE(SUM("syncSeq"::bigint), 0) AS sum
    FROM "File"
    WHERE "userId" = ${userId} AND "encrypted" AND NOT "unreadable"`
  return { count: Number(state.count), sum: state.sum.toString() }
}

/** The records that changed after `since`, oldest change first. */
export async function syncEncryptedFiles(
  userId: string,
  since: number,
  limit = SYNC_PAGE_SIZE
) {
  const take = Math.min(Math.max(1, limit), SYNC_PAGE_MAX)
  // The state first: a change that commits after it shows as a difference,
  // and the client asks again.
  const state = await syncState(userId)
  const rows = await prisma.file.findMany({
    where: { ...readable(userId), syncSeq: { gt: since } },
    orderBy: { syncSeq: 'asc' },
    take: take + 1,
    select: syncSelect,
  })
  return {
    records: await records(rows.slice(0, take)),
    more: rows.length > take,
    state,
  }
}

/** The records of named files, for a cache that found them missing or old. */
export async function syncFilesById(userId: string, ids: string[]) {
  const rows = await prisma.file.findMany({
    where: { ...readable(userId), id: { in: ids } },
    select: syncSelect,
  })
  return { records: await records(rows), more: false }
}

/** Every encrypted file of the account as `[id, seq]`, in pages by ID. */
export async function syncIndex(userId: string, after: string | null) {
  const rows = await prisma.file.findMany({
    where: { ...readable(userId), ...(after ? { id: { gt: after } } : {}) },
    orderBy: { id: 'asc' },
    take: SYNC_INDEX_PAGE_SIZE + 1,
    select: { id: true, syncSeq: true },
  })
  return {
    entries: rows
      .slice(0, SYNC_INDEX_PAGE_SIZE)
      .map((row) => [row.id, row.syncSeq] as const),
    more: rows.length > SYNC_INDEX_PAGE_SIZE,
  }
}

export const PLAIN_TEXT_PAGE_SIZE = 500

/**
 * The names and the image text of the plain files of the account, in pages
 * by ID. The server can read both. The owner's browser uses them to apply a
 * tag rule that the server cannot read (section 9.5).
 */
export async function plainFileText(userId: string, after: string | null) {
  const rows = await prisma.file.findMany({
    where: {
      userId,
      encrypted: false,
      ...(after ? { id: { gt: after } } : {}),
    },
    orderBy: { id: 'asc' },
    take: PLAIN_TEXT_PAGE_SIZE + 1,
    select: { id: true, name: true, ocrText: true },
  })
  return {
    files: rows.slice(0, PLAIN_TEXT_PAGE_SIZE),
    more: rows.length > PLAIN_TEXT_PAGE_SIZE,
  }
}
