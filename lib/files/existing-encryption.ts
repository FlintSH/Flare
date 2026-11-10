import { type FileEncryptionJob, Prisma } from '@prisma/client'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { clearArchiveIndexCache } from '@/lib/archives/index-cache'
import { recordAudit } from '@/lib/audit'
import { getConfig } from '@/lib/config'
import { lockFileEncryptionClaims, lockUserRow } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import {
  type AccountPublicKey,
  type FileKey,
  type FolderPublicKey,
  createRandomFile,
  decryptFile,
  encodeStoredRecord,
  encryptFile,
  headerHash,
  sealFileMetadataWithRandomNonce,
  sealOcrTextWithRandomNonce,
  sealThumbnailWithRandomNonce,
  storedLengthOf,
  wipe,
  wrapAccountStanzaWithRandomKey,
  wrapFolderFileStanzaWithRandomKey,
} from '@/lib/e2ee'
import { loggers } from '@/lib/logger'
import { type StorageProvider, getStorageProvider } from '@/lib/storage'
import { isMissingObject } from '@/lib/storage/missing'
import {
  type StorageTarget,
  captureStorageTarget,
  parseStorageTarget,
  sameStorageTarget,
} from '@/lib/storage/targets'
import { bytesToMB } from '@/lib/utils/size'

import { ENCRYPTED_FILE_NAME, ENCRYPTED_FILE_TYPE } from './encrypted'
import { encryptedFileId } from './encrypted-id'
import { serverCanThumbnail, serverThumbnail } from './existing-thumbnail'
import { accountHasSealedTags } from './library-records'

/**
 * The server encrypts the files that an account had before end-to-end
 * encryption (docs/e2ee-spec.md, section 14.2). The server has the plaintext
 * of such a file already, and the encryption of a file to a public key needs
 * no secret, so the browser of the owner does not download anything.
 *
 * One file is one `FileEncryptionJob`. An attempt has these steps:
 *
 * 1. Claim: a lease on the job. A lease that ran out is taken over.
 * 2. Journal: the path of the new ciphertext object is recorded in the job
 *    before the first byte reaches storage.
 * 3. Write: the plaintext is read as a stream, encrypted and written to that
 *    new path. The plaintext object is not touched. The number of bytes
 *    that were read must be the stored size of the plaintext object.
 * 4. Verify: the ciphertext is read back and decrypted. Its length and the
 *    hash of its plaintext must be those of the bytes that were read.
 * 5. Switch: one transaction, with the row of the account and the row of
 *    the file locked. It checks the lease and that the file is still the
 *    plain file that was read, makes the small records from the locked row
 *    for the account key of that moment, points the row at the ciphertext,
 *    removes the plain name, type and text, queues the deletion of the
 *    plaintext object, and finishes the job.
 * 6. Delete: the plaintext object is deleted. If this stops, the queued
 *    deletion of step 5 does it later.
 *
 * At each moment the row points at one complete object: the plaintext
 * before the commit of step 5, the verified ciphertext after it. An attempt
 * that stops before that commit leaves the file as it was, and the journal
 * of step 2 lets the next attempt remove what it wrote. `file_key` exists in
 * the memory of one attempt only. Nothing here logs or stores a file name.
 */

export const FILE_ENCRYPTION_CONCURRENCY = 2
export const FILE_ENCRYPTION_LEASE_MS = 120_000
export const FILE_ENCRYPTION_HEARTBEAT_MS = 30_000
export const FILE_ENCRYPTION_MAX_ATTEMPTS = 3
export const FILE_ENCRYPTION_RETRY_MS = 30_000
/** How long a job waits when the browser of the owner has work to do first. */
export const FILE_ENCRYPTION_WAIT_MS = 30_000
/** A finished job is kept this long, for the progress that the owner sees. */
export const FILE_ENCRYPTION_KEEP_DONE_MS = 7 * 24 * 60 * 60 * 1000
/** The most UTF-8 bytes of image text in one sealed record (section 9.6.1). */
const OCR_TEXT_MAX_BYTES = 250_000
/** The event loop gets a turn after this many bytes. */
const YIELD_EVERY_BYTES = 1024 * 1024

export const EXISTING_FILES_CHOICES = ['none', 'private', 'all'] as const
export type ExistingFilesChoice = (typeof EXISTING_FILES_CHOICES)[number]

/** Why an attempt did not encrypt a file. A fixed list: no free text is stored. */
export const FILE_ENCRYPTION_ERROR_CODES = [
  'account_keys_missing',
  'library_not_ready',
  'source_missing',
  'storage_read_failed',
  'storage_write_failed',
  'verification_failed',
  'interrupted',
  'internal_error',
] as const
export type FileEncryptionErrorCode =
  (typeof FILE_ENCRYPTION_ERROR_CODES)[number]

export type FileEncryptionResult = 'encrypted' | 'skipped' | 'gone'
export type FileEncryptionOutcome =
  FileEncryptionResult | 'postponed' | 'retry' | 'failed' | 'lost'

const logger = loggers.files

type Tx = Prisma.TransactionClient

class JobError extends Error {
  constructor(
    readonly code: FileEncryptionErrorCode,
    readonly retry = true
  ) {
    super(code)
    this.name = 'FileEncryptionJobError'
  }
}

/**
 * A test throws this from a step to stop an attempt as a crash does: no
 * cleanup runs, and the lease stays until it runs out.
 */
export class StoppedAttemptForTestsOnly extends Error {}

/** Where a test can stop or disturb an attempt. Production passes none. */
export interface FileEncryptionSteps {
  afterJournal?(): unknown
  afterWrite?(): unknown
  afterVerify?(): unknown
  /** Inside the switch transaction, after every write. */
  beforeCommit?(): unknown
  afterCommit?(): unknown
}

export interface FileEncryptionOptions {
  storage?: StorageProvider
  /** Whether the instance reads the text of images (section 9.7). */
  automaticOcr?: boolean
  steps?: FileEncryptionSteps
}

// --- The gate (section 14.2: "Before the server starts") ---

/**
 * Whether the browser of the owner made the key pairs of every folder and
 * the sealed record of every tag. Until then no file of the account is
 * encrypted: a file in a folder without keys could get no folder stanza, and
 * a rule of a plain tag would have nothing to read.
 */
export async function libraryReadyForEncryption(
  db: Pick<Tx, 'vaultFolder' | 'vaultTag'>,
  userId: string
) {
  const [folder, tag] = await Promise.all([
    db.vaultFolder.findFirst({
      where: { userId, folderPublicKey: null },
      select: { id: true },
    }),
    db.vaultTag.findFirst({
      where: { userId, sealedTagMetadata: null },
      select: { id: true },
    }),
  ])
  return !folder && !tag
}

// --- The queue ---

export type FileEncryptionSelection =
  { scope: 'private' | 'all' } | { fileIds: string[] }

/**
 * Queues plain files of `userId`. `private` is each private file without a
 * server-side password, and such a job encrypts its file only while that is
 * still true. A file that already has a job is queued again when the job
 * failed or finished without encrypting. Returns how many jobs wait.
 */
export async function enqueueFileEncryption(
  tx: Pick<Tx, '$executeRaw'>,
  userId: string,
  selection: FileEncryptionSelection
) {
  const onlyIfPrivate = 'scope' in selection && selection.scope === 'private'
  const which =
    'fileIds' in selection
      ? Prisma.sql`AND file.id IN (${Prisma.join(selection.fileIds)})`
      : onlyIfPrivate
        ? Prisma.sql`AND file.visibility = 'PRIVATE' AND file.password IS NULL`
        : Prisma.empty
  return tx.$executeRaw`
    INSERT INTO "FileEncryptionJob" AS job
      (id, "userId", "fileId", "onlyIfPrivate", "updatedAt")
    SELECT gen_random_uuid()::text, file."userId", file.id, ${onlyIfPrivate}, NOW()
    FROM "File" AS file
    WHERE file."userId" = ${userId} AND file.encrypted = false ${which}
    ON CONFLICT ("fileId") DO UPDATE SET
      "onlyIfPrivate" = job."onlyIfPrivate" AND EXCLUDED."onlyIfPrivate",
      status = CASE WHEN job.status IN ('failed', 'done') THEN 'pending' ELSE job.status END,
      attempts = CASE WHEN job.status IN ('failed', 'done') THEN 0 ELSE job.attempts END,
      "availableAt" = CASE WHEN job.status = 'processing' THEN job."availableAt" ELSE NOW() END,
      "errorCode" = CASE WHEN job.status = 'processing' THEN job."errorCode" ELSE NULL END,
      result = NULL,
      "finishedAt" = NULL,
      "updatedAt" = NOW()
  `
}

/** Takes back the jobs of `userId` that no attempt started. */
export async function cancelWaitingFileEncryption(
  tx: Pick<Tx, 'fileEncryptionJob'>,
  userId: string
) {
  const removed = await tx.fileEncryptionJob.deleteMany({
    where: { userId, status: { in: ['pending', 'failed'] } },
  })
  return removed.count
}

const released = {
  leaseId: null,
  leaseUntil: null,
  ciphertextPath: null,
  ciphertextTarget: Prisma.DbNull,
}

/**
 * Queues the removal of an object that an attempt wrote and no file uses.
 * The check for a file with that path is a second safeguard: the switch
 * clears the journal in the transaction that gives the path to a file.
 */
async function queueWrittenObject(
  tx: Pick<Tx, '$executeRaw'>,
  ownerId: string,
  path: string,
  target: StorageTarget | null,
  notBefore: Date
) {
  await tx.$executeRaw`
    INSERT INTO "StorageDeletion"
      (id, "ownerId", path, provider, target, "availableAt", "updatedAt")
    SELECT gen_random_uuid()::text, ${ownerId}, ${path},
      ${target?.provider ?? 'unknown'}, ${JSON.stringify(target ?? {})}::jsonb,
      ${notBefore}, NOW()
    WHERE NOT EXISTS (SELECT 1 FROM "File" WHERE path = ${path})
  `
}

/**
 * Leases up to `FILE_ENCRYPTION_CONCURRENCY` jobs across every process. An
 * attempt whose lease ran out is taken back first: the object that it may
 * have written is queued for deletion, not before the time a slow writer
 * needs to notice that it lost the lease. Accounts take turns, so the
 * library of one account does not hold back the others.
 */
export async function claimFileEncryptions(
  limit = FILE_ENCRYPTION_CONCURRENCY
): Promise<FileEncryptionJob[]> {
  return prisma.$transaction(async (tx) => {
    await lockFileEncryptionClaims(tx)
    const now = new Date()
    const stopped = await tx.fileEncryptionJob.findMany({
      where: { status: 'processing', leaseUntil: { lte: now } },
    })
    for (const job of stopped) {
      if (job.ciphertextPath)
        await queueWrittenObject(
          tx,
          job.userId,
          job.ciphertextPath,
          parseStorageTarget(job.ciphertextTarget),
          new Date(now.getTime() + FILE_ENCRYPTION_LEASE_MS)
        )
      await tx.fileEncryptionJob.update({
        where: { id: job.id },
        data: { ...released, status: 'pending', errorCode: 'interrupted' },
      })
    }
    const active = await tx.fileEncryptionJob.count({
      where: { status: 'processing' },
    })
    const slots = Math.max(0, limit - active)
    if (!slots) return []
    const leaseId = randomUUID()
    const leaseUntil = new Date(now.getTime() + FILE_ENCRYPTION_LEASE_MS)
    return tx.$queryRaw<FileEncryptionJob[]>`
      WITH ranked AS (
        SELECT id, "availableAt", ROW_NUMBER() OVER (
          PARTITION BY "userId" ORDER BY "availableAt", "createdAt", id
        ) AS turn
        FROM "FileEncryptionJob"
        WHERE status = 'pending' AND "availableAt" <= ${now}
      ), candidates AS (
        SELECT id FROM ranked ORDER BY turn, "availableAt", id LIMIT ${slots}
      )
      UPDATE "FileEncryptionJob" AS job
      SET status = 'processing', attempts = attempts + 1,
        "leaseId" = ${leaseId}, "leaseUntil" = ${leaseUntil}, "updatedAt" = ${now}
      FROM candidates WHERE job.id = candidates.id
      RETURNING job.*
    `
  })
}

/** Removes the jobs that finished long ago. Returns how many. */
export async function pruneFinishedFileEncryptions(now = new Date()) {
  const removed = await prisma.fileEncryptionJob.deleteMany({
    where: {
      status: 'done',
      finishedAt: {
        lt: new Date(now.getTime() - FILE_ENCRYPTION_KEEP_DONE_MS),
      },
    },
  })
  return removed.count
}

// --- One attempt ---

const held = (job: FileEncryptionJob) => ({
  id: job.id,
  status: 'processing',
  leaseId: job.leaseId,
})

async function renewLease(job: FileEncryptionJob) {
  const renewed = await prisma.fileEncryptionJob.updateMany({
    where: held(job),
    data: { leaseUntil: new Date(Date.now() + FILE_ENCRYPTION_LEASE_MS) },
  })
  return renewed.count === 1
}

async function finishJob(
  tx: Pick<Tx, 'fileEncryptionJob'>,
  job: FileEncryptionJob,
  result: FileEncryptionResult
) {
  const finished = await tx.fileEncryptionJob.updateMany({
    where: held(job),
    data: {
      ...released,
      status: 'done',
      result,
      errorCode: null,
      finishedAt: new Date(),
    },
  })
  return finished.count === 1
}

const turn = () => new Promise<void>((resolve) => setImmediate(resolve))

/** `text` cut to at most `maxBytes` bytes of UTF-8, never inside a character. */
function cutUtf8(text: string, maxBytes: number) {
  const bytes = new TextEncoder().encode(text)
  if (bytes.length <= maxBytes) return text
  let end = maxBytes
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--
  return new TextDecoder().decode(bytes.subarray(0, end))
}

const stored = (bytes: Uint8Array): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(bytes)

/** The image optimizer of Next.js keeps resized copies of public images on disk. */
async function purgeImageOptimizerCache() {
  try {
    await rm(
      join(/* turbopackIgnore: true */ process.cwd(), '.next/cache/images'),
      { recursive: true, force: true }
    )
  } catch {
    logger.warn(
      'Could not clear .next/cache/images after a public image was encrypted; delete that directory'
    )
  }
}

const ARCHIVE_TYPE = /zip|tar|rar|7z|compress|archive|gzip|bzip|xz/i

interface Pass {
  length: number
  digest: Buffer
  /** The bytes of a small image, for the thumbnail. */
  image: Uint8Array | null
}

/**
 * Reads the plaintext object one time and writes its ciphertext to
 * `ciphertextPath`. Memory use is two chunks and one piece of the source,
 * and the whole of an image only while a thumbnail is possible.
 */
async function writeCiphertext(input: {
  storage: StorageProvider
  sourcePath: string
  ciphertextPath: string
  type: string
  expectedBytes: number
  fileKey: FileKey
  noncePrefix: ReturnType<typeof createRandomFile>['noncePrefix']
  lost: () => boolean
  signal: AbortSignal
}): Promise<Pass> {
  const hash = createHash('sha256')
  let length = 0
  let sinceTurn = 0
  let kept: Buffer[] | null = serverCanThumbnail(
    input.type,
    input.expectedBytes
  )
    ? []
    : null
  let readFailed: unknown = null
  let source: Readable
  try {
    source = await input.storage.getFileStream(
      input.sourcePath,
      undefined,
      input.signal
    )
  } catch (error) {
    throw new JobError(
      isMissingObject(error) ? 'source_missing' : 'storage_read_failed',
      !isMissingObject(error)
    )
  }
  async function* plaintext() {
    try {
      for await (const piece of source) {
        const bytes = piece as Buffer
        hash.update(bytes)
        length += bytes.length
        if (kept) {
          if (serverCanThumbnail(input.type, length)) kept.push(bytes)
          else kept = null
        }
        yield bytes
        sinceTurn += bytes.length
        if (sinceTurn >= YIELD_EVERY_BYTES) {
          sinceTurn = 0
          if (input.lost()) throw new JobError('interrupted')
          await turn()
        }
      }
    } catch (error) {
      readFailed = error
      throw error
    }
  }
  try {
    await input.storage.uploadStream(
      Readable.from(
        encryptFile(input.fileKey, input.noncePrefix, plaintext()),
        { objectMode: false }
      ),
      input.ciphertextPath,
      ENCRYPTED_FILE_TYPE,
      input.signal
    )
  } catch (error) {
    source.destroy()
    if (error instanceof JobError) throw error
    if (readFailed instanceof JobError) throw readFailed
    if (readFailed)
      throw new JobError(
        isMissingObject(readFailed) ? 'source_missing' : 'storage_read_failed',
        !isMissingObject(readFailed)
      )
    throw new JobError('storage_write_failed')
  }
  // A read that ended early without an error would pass the verification,
  // because the ciphertext matches what was read. The plaintext object is
  // deleted later, so every byte of it must have been read.
  let stored: number
  try {
    stored = await input.storage.getFileSize(input.sourcePath)
  } catch (error) {
    throw new JobError(
      isMissingObject(error) ? 'source_missing' : 'storage_read_failed',
      !isMissingObject(error)
    )
  }
  if (stored !== length) throw new JobError('storage_read_failed')
  return {
    length,
    digest: hash.digest(),
    image: kept && length > 0 ? Buffer.concat(kept) : null,
  }
}

/**
 * Reads the new object back and decrypts it. A stored object that is not
 * exactly the ciphertext of the bytes that were read fails here, before
 * anything points at it.
 */
async function verifyCiphertext(input: {
  storage: StorageProvider
  ciphertextPath: string
  fileKey: FileKey
  pass: Pass
  lost: () => boolean
  signal: AbortSignal
}) {
  const failed = () => new JobError('verification_failed')
  try {
    const size = await input.storage.getFileSize(input.ciphertextPath)
    if (size !== storedLengthOf(input.pass.length)) throw failed()
    const hash = createHash('sha256')
    let length = 0
    let sinceTurn = 0
    const ciphertext = await input.storage.getFileStream(
      input.ciphertextPath,
      undefined,
      input.signal
    )
    for await (const piece of decryptFile(input.fileKey, ciphertext)) {
      hash.update(piece)
      length += piece.length
      sinceTurn += piece.length
      wipe(piece)
      if (sinceTurn >= YIELD_EVERY_BYTES) {
        sinceTurn = 0
        if (input.lost()) throw new JobError('interrupted')
        await turn()
      }
    }
    if (
      length !== input.pass.length ||
      !hash.digest().equals(input.pass.digest)
    )
      throw failed()
  } catch (error) {
    if (error instanceof JobError) throw error
    throw failed()
  }
}

type SwitchResult =
  | {
      outcome: 'encrypted'
      /** The queued deletion of the plaintext object in the storage that was read. */
      cleanupId: string
      purgeImages: boolean
      archive: boolean
    }
  | { outcome: 'skipped' | 'gone' | 'lost' | 'postponed' }

/**
 * Step 5. Everything that makes the file an encrypted file is one
 * transaction, so no reader sees a row between the two states.
 */
async function switchFile(input: {
  job: FileEncryptionJob
  sourcePath: string
  sourceTarget: StorageTarget
  ciphertextPath: string
  ciphertextTarget: StorageTarget
  urlName: string
  fileKey: FileKey
  header: Uint8Array
  plaintextLength: number
  thumbnail: Uint8Array | null
  automaticOcr: boolean
  steps: FileEncryptionSteps
}): Promise<SwitchResult> {
  const { job } = input
  return prisma.$transaction(
    async (tx): Promise<SwitchResult> => {
      // The lock that uploads, deletions, expiry, folder and tag changes and
      // a key rotation take. Then the row of the file.
      await lockUserRow(tx, job.userId)
      await tx.$queryRaw`SELECT id FROM "File" WHERE id = ${job.fileId} FOR UPDATE`
      const current = await tx.fileEncryptionJob.findUnique({
        where: { id: job.id },
      })
      if (
        !current ||
        current.status !== 'processing' ||
        current.leaseId !== job.leaseId
      )
        return { outcome: 'lost' }
      const now = new Date()
      const discard = () =>
        queueWrittenObject(
          tx,
          job.userId,
          input.ciphertextPath,
          input.ciphertextTarget,
          now
        )
      const file = await tx.file.findUnique({
        where: { id: job.fileId },
        include: {
          folder: { select: { folderPublicKey: true, rekeyPending: true } },
        },
      })
      if (!file || file.userId !== job.userId) {
        await discard()
        await finishJob(tx, job, 'gone')
        return { outcome: 'gone' }
      }
      // Already encrypted, or its bytes are no longer the object that was
      // read, or the owner made it public or gave it a password while a job
      // for private files ran.
      if (
        file.encrypted ||
        file.path !== input.sourcePath ||
        (current.onlyIfPrivate &&
          (file.visibility !== 'PRIVATE' || file.password !== null))
      ) {
        await discard()
        await finishJob(tx, job, 'skipped')
        return { outcome: 'skipped' }
      }
      const user = await tx.user.findUnique({
        where: { id: job.userId },
        select: { urlId: true, accountPublicKey: true },
      })
      // The account key of this moment: a rotation takes the same lock.
      if (!user?.accountPublicKey)
        throw new JobError('account_keys_missing', false)
      if (!(await libraryReadyForEncryption(tx, job.userId))) {
        await discard()
        await tx.fileEncryptionJob.updateMany({
          where: held(job),
          data: {
            ...released,
            status: 'pending',
            errorCode: 'library_not_ready',
            attempts: { decrement: 1 },
            availableAt: new Date(now.getTime() + FILE_ENCRYPTION_WAIT_MS),
          },
        })
        return { outcome: 'postponed' }
      }

      const hash = headerHash(input.header)
      const sealedMetadata = stored(
        encodeStoredRecord(
          'sealed_metadata',
          sealFileMetadataWithRandomNonce({
            fileKey: input.fileKey,
            headerHash: hash,
            metadata: { name: file.name, type: file.mimeType },
          })
        )
      )
      const accountPublicKey = stored(user.accountPublicKey)
      const accountStanza = stored(
        encodeStoredRecord(
          'account_stanza',
          wrapAccountStanzaWithRandomKey({
            accountPublicKey: accountPublicKey as AccountPublicKey,
            headerHash: hash,
            fileKey: input.fileKey,
          })
        )
      )
      // The server has only a hash of a server-side password and cannot
      // make a password stanza. Such a file would be open to everyone who
      // has its link, so it is private until its owner decides.
      const hadPassword = file.password !== null
      const visibility = hadPassword ? 'PRIVATE' : file.visibility
      const folderKey =
        visibility === 'PUBLIC' &&
        file.folder?.folderPublicKey &&
        !file.folder.rekeyPending
          ? stored(file.folder.folderPublicKey)
          : null
      const folderStanza = folderKey
        ? stored(
            encodeStoredRecord(
              'folder_file_stanza',
              wrapFolderFileStanzaWithRandomKey({
                folderPublicKey: folderKey as FolderPublicKey,
                headerHash: hash,
                fileKey: input.fileKey,
              })
            )
          )
        : null
      const text = file.ocrText?.trim() ?? ''
      const sealedOcrText = text
        ? stored(
            encodeStoredRecord(
              'sealed_ocr_text',
              sealOcrTextWithRandomNonce({
                fileKey: input.fileKey,
                headerHash: hash,
                ocrText: cutUtf8(text, OCR_TEXT_MAX_BYTES),
              })
            )
          )
        : null
      const sealedThumbnail = input.thumbnail
        ? stored(
            encodeStoredRecord(
              'sealed_thumbnail',
              sealThumbnailWithRandomNonce({
                fileKey: input.fileKey,
                headerHash: hash,
                thumbnail: input.thumbnail,
              })
            )
          )
        : null
      const isImage = file.mimeType.startsWith('image/')
      // No client applied the tag rules to the encrypted form (section 9.7).
      const rulesPending = await accountHasSealedTags(tx, job.userId)
      // The server read no text, or its recognition failed: the browser of
      // the owner reads the image. An empty text is a result.
      const ocrPending = input.automaticOcr && isImage && file.ocrText === null
      const size = bytesToMB(storedLengthOf(input.plaintextLength))
      const urlPath = `/${user.urlId}/${input.urlName}`

      // Raw statements: the audit of model writes would copy the name of
      // the file into an audit record.
      const switched = await tx.$executeRaw`
        UPDATE "File" SET
          name = ${ENCRYPTED_FILE_NAME},
          "mimeType" = ${ENCRYPTED_FILE_TYPE},
          "urlPath" = ${urlPath},
          path = ${input.ciphertextPath},
          "storageTarget" = ${JSON.stringify(input.ciphertextTarget)}::jsonb,
          size = ${size},
          visibility = ${visibility}::"FileVisibility",
          password = NULL,
          "passwordPendingFrom" = ${hadPassword ? file.visibility : null}::"FileVisibility",
          "ocrText" = NULL,
          "ocrConfidence" = NULL,
          "isOcrProcessed" = false,
          "ocrTagsPendingAt" = NULL,
          encrypted = true,
          header = ${stored(input.header)},
          "sealedMetadata" = ${sealedMetadata},
          "accountStanza" = ${accountStanza},
          "stanzaAccountPublicKey" = ${accountPublicKey},
          "passwordStanza" = NULL,
          "folderStanza" = ${folderStanza},
          "folderStanzaPublicKey" = ${folderKey},
          "rulesPending" = ${rulesPending},
          "ocrPending" = ${ocrPending},
          "thumbnailPending" = ${!sealedThumbnail},
          "pendingAttempts" = 0,
          unreadable = false
        WHERE id = ${file.id} AND encrypted = false AND path = ${input.sourcePath}
      `
      if (switched !== 1) throw new JobError('internal_error')
      if (sealedOcrText || sealedThumbnail)
        await tx.fileSealedData.upsert({
          where: { fileId: file.id },
          create: { fileId: file.id, sealedOcrText, sealedThumbnail },
          update: { sealedOcrText, sealedThumbnail },
        })
      await tx.$executeRaw`
        UPDATE "User" SET "storageUsed" = GREATEST(0, "storageUsed" + ${size - file.size})
        WHERE id = ${job.userId}
      `
      // The plaintext object, in the storage that delivery read it from.
      const cleanup = await tx.storageDeletion.create({
        data: {
          ownerId: job.userId,
          path: input.sourcePath,
          provider: input.sourceTarget.provider,
          target: input.sourceTarget,
        },
        select: { id: true },
      })
      // A copy that the row records in a different storage is plaintext too.
      const recorded = parseStorageTarget(file.storageTarget)
      if (recorded && !sameStorageTarget(recorded, input.sourceTarget))
        await tx.storageDeletion.create({
          data: {
            ownerId: job.userId,
            path: input.sourcePath,
            provider: recorded.provider,
            target: recorded,
          },
        })
      // The name of the file in records that the application wrote earlier.
      await tx.$executeRaw`
        UPDATE "Event" SET payload = payload - 'fileName'
        WHERE type IN ('file.schedule-expiration', 'file.expired')
          AND payload->>'fileId' = ${file.id} AND payload ? 'fileName'
      `
      await tx.$executeRaw`
        UPDATE "AuditEvent" SET "targetName" = NULL,
          details = details #- '{before,name}' #- '{after,name}'
            #- '{before,mimeType}' #- '{after,mimeType}'
        WHERE ("targetId" = ${file.id} AND "targetType" = 'file')
          OR ("targetId" LIKE ${`${file.id}:%`} AND "targetType" = 'file_tag')
      `
      await tx.$executeRaw`
        UPDATE "WebhookDelivery" SET payload = jsonb_set(
          jsonb_set(payload, '{data,name}', 'null'::jsonb),
          '{data,mimeType}', 'null'::jsonb
        )
        WHERE "eventId" = ${`file.ready:${file.id}`}
      `
      if (!(await finishJob(tx, job, 'encrypted')))
        throw new JobError('interrupted')
      await input.steps.beforeCommit?.()
      return {
        outcome: 'encrypted',
        cleanupId: cleanup.id,
        purgeImages: file.visibility === 'PUBLIC' && isImage,
        archive: ARCHIVE_TYPE.test(file.mimeType),
      }
    },
    { timeout: 30_000, maxWait: 15_000 }
  )
}

/** An attempt that cannot go on: back to the queue, or failed for the owner to retry. */
async function failJob(
  job: FileEncryptionJob,
  written: {
    path: string
    target: StorageTarget
    storage: StorageProvider
  } | null,
  error: unknown
): Promise<FileEncryptionOutcome> {
  const code: FileEncryptionErrorCode =
    error instanceof JobError ? error.code : 'internal_error'
  const retry =
    (error instanceof JobError ? error.retry : true) &&
    job.attempts < FILE_ENCRYPTION_MAX_ATTEMPTS
  const now = new Date()
  const ours = await prisma.$transaction(async (tx) => {
    const updated = await tx.fileEncryptionJob.updateMany({
      where: held(job),
      data: {
        ...released,
        status: retry ? 'pending' : 'failed',
        errorCode: code,
        availableAt: new Date(
          now.getTime() +
            FILE_ENCRYPTION_RETRY_MS * 2 ** Math.max(0, job.attempts - 1)
        ),
      },
    })
    if (updated.count !== 1) return false
    if (written)
      await queueWrittenObject(
        tx,
        job.userId,
        written.path,
        written.target,
        now
      )
    return true
  })
  if (!ours && written) {
    // Another attempt has the job. It queued the object of this one for
    // later; removing it now is the same result sooner.
    try {
      if (
        !(await prisma.file.findFirst({
          where: { path: written.path },
          select: { id: true },
        }))
      )
        await written.storage.deleteFile(written.path)
    } catch {
      // The queued deletion removes it.
    }
  }
  // The code and the IDs only: a storage error can hold a path, and the
  // path of a plain file holds its name.
  logger.warn('Could not encrypt an existing file', {
    fileId: job.fileId,
    code,
    retry,
  })
  return ours ? (retry ? 'retry' : 'failed') : 'lost'
}

/** Runs one attempt for a job that `claimFileEncryptions` leased. */
export async function processFileEncryption(
  job: FileEncryptionJob,
  options: FileEncryptionOptions = {}
): Promise<FileEncryptionOutcome> {
  if (job.status !== 'processing' || !job.leaseId) return 'lost'
  const steps = options.steps ?? {}
  let lost = false
  const abort = new AbortController()
  let heartbeatBusy = false
  const heartbeat = setInterval(() => {
    if (heartbeatBusy) return
    heartbeatBusy = true
    void renewLease(job)
      .then((kept) => {
        if (!kept) {
          lost = true
          abort.abort()
        }
      })
      .catch(() => undefined)
      .finally(() => {
        heartbeatBusy = false
      })
  }, FILE_ENCRYPTION_HEARTBEAT_MS)
  heartbeat.unref()
  let fileKey: FileKey | null = null
  let written: {
    path: string
    target: StorageTarget
    storage: StorageProvider
  } | null = null
  try {
    const file = await prisma.file.findUnique({
      where: { id: job.fileId },
      select: {
        userId: true,
        encrypted: true,
        path: true,
        mimeType: true,
        size: true,
        visibility: true,
        password: true,
      },
    })
    if (!file || file.userId !== job.userId)
      return (await finishJob(prisma, job, 'gone')) ? 'gone' : 'lost'
    if (
      file.encrypted ||
      (job.onlyIfPrivate &&
        (file.visibility !== 'PRIVATE' || file.password !== null))
    )
      return (await finishJob(prisma, job, 'skipped')) ? 'skipped' : 'lost'
    const user = await prisma.user.findUnique({
      where: { id: job.userId },
      select: { urlId: true, accountPublicKey: true },
    })
    if (!user?.accountPublicKey)
      throw new JobError('account_keys_missing', false)
    if (!(await libraryReadyForEncryption(prisma, job.userId))) {
      const waiting = await prisma.fileEncryptionJob.updateMany({
        where: held(job),
        data: {
          ...released,
          status: 'pending',
          errorCode: 'library_not_ready',
          attempts: { decrement: 1 },
          availableAt: new Date(Date.now() + FILE_ENCRYPTION_WAIT_MS),
        },
      })
      return waiting.count === 1 ? 'postponed' : 'lost'
    }
    const storage = options.storage ?? (await getStorageProvider())
    const target = captureStorageTarget(storage)
    const automaticOcr =
      options.automaticOcr ?? (await getConfig()).settings.general.ocr.enabled

    // Step 2: the journal, before the first byte.
    const urlName = encryptedFileId(Uint8Array.from(randomBytes(16)))
    const ciphertextPath = `uploads/${user.urlId}/${randomUUID()}/${urlName}`
    const journal = await prisma.fileEncryptionJob.updateMany({
      where: held(job),
      data: { ciphertextPath, ciphertextTarget: target },
    })
    if (journal.count !== 1) return 'lost'
    written = { path: ciphertextPath, target, storage }
    await steps.afterJournal?.()

    // Steps 3 and 4.
    const created = createRandomFile()
    fileKey = created.fileKey
    const pass = await writeCiphertext({
      storage,
      sourcePath: file.path,
      ciphertextPath,
      type: file.mimeType,
      expectedBytes: Math.round(file.size * 1024 * 1024),
      fileKey,
      noncePrefix: created.noncePrefix,
      lost: () => lost,
      signal: abort.signal,
    })
    await steps.afterWrite?.()
    await verifyCiphertext({
      storage,
      ciphertextPath,
      fileKey,
      pass,
      lost: () => lost,
      signal: abort.signal,
    })
    await steps.afterVerify?.()
    const thumbnail = pass.image ? await serverThumbnail(pass.image) : null
    if (lost || !(await renewLease(job))) throw new JobError('interrupted')

    // Step 5.
    const result = await switchFile({
      job,
      sourcePath: file.path,
      sourceTarget: target,
      ciphertextPath,
      ciphertextTarget: target,
      urlName,
      fileKey,
      header: created.header,
      plaintextLength: pass.length,
      thumbnail,
      automaticOcr,
      steps,
    })
    if (result.outcome === 'lost') throw new JobError('interrupted')
    if (result.outcome !== 'encrypted') return result.outcome
    // The row uses the new object from here on.
    written = null
    await steps.afterCommit?.()

    // Step 6. The queued deletion of step 5 covers a failure here: the
    // storage worker deletes the object later.
    const queued = { id: result.cleanupId, status: 'pending' }
    try {
      await storage.deleteFile(file.path)
      await prisma.storageDeletion.deleteMany({ where: queued })
    } catch (error) {
      if (isMissingObject(error))
        await prisma.storageDeletion
          .deleteMany({ where: queued })
          .catch(() => undefined)
    }
    if (result.purgeImages) await purgeImageOptimizerCache()
    if (result.archive) clearArchiveIndexCache()
    await recordAudit({
      action: 'file.encrypted_by_server',
      category: 'files',
      actorName: 'System',
      targetType: 'file',
      targetId: job.fileId,
      details: { ownerId: job.userId },
    })
    return 'encrypted'
  } catch (error) {
    if (error instanceof StoppedAttemptForTestsOnly) throw error
    return failJob(job, written, error)
  } finally {
    clearInterval(heartbeat)
    if (fileKey) wipe(fileKey)
  }
}

// --- What the owner sees ---

/** The plain files of an account by the three kinds of section 14.2, and the state of its jobs. */
export async function existingFilesStatus(userId: string) {
  const [user, kinds, jobs, failed, passwordPending, ready] = await Promise.all(
    [
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          existingFilesChoice: true,
          existingFilesChoiceAt: true,
          accountPublicKey: true,
        },
      }),
      prisma.$queryRaw<{ kind: string; files: bigint }[]>`
      SELECT CASE
          WHEN password IS NOT NULL THEN 'password'
          WHEN visibility = 'PUBLIC' THEN 'public'
          ELSE 'private'
        END AS kind, COUNT(*) AS files
      FROM "File" WHERE "userId" = ${userId} AND encrypted = false
      GROUP BY 1
    `,
      prisma.$queryRaw<{ state: string; jobs: bigint }[]>`
      SELECT CASE WHEN status = 'done' THEN COALESCE(result, 'done') ELSE status END AS state,
        COUNT(*) AS jobs
      FROM "FileEncryptionJob" WHERE "userId" = ${userId}
      GROUP BY 1
    `,
      prisma.fileEncryptionJob.findMany({
        where: { userId, status: 'failed' },
        orderBy: { updatedAt: 'desc' },
        take: 50,
        select: { fileId: true, errorCode: true },
      }),
      prisma.file.count({
        where: { userId, passwordPendingFrom: { not: null } },
      }),
      libraryReadyForEncryption(prisma, userId),
    ]
  )
  const names = new Map(
    failed.length
      ? (
          await prisma.file.findMany({
            where: {
              userId,
              encrypted: false,
              id: { in: failed.map((job) => job.fileId) },
            },
            select: { id: true, name: true },
          })
        ).map((file) => [file.id, file.name])
      : []
  )
  const plain = { private: 0, public: 0, password: 0 }
  for (const row of kinds)
    if (row.kind in plain)
      plain[row.kind as keyof typeof plain] = Number(row.files)
  const count = (state: string) =>
    Number(jobs.find((row) => row.state === state)?.jobs ?? 0)
  return {
    hasKeys: Boolean(user?.accountPublicKey),
    choice: (user?.existingFilesChoice ?? null) as ExistingFilesChoice | null,
    choiceAt: user?.existingFilesChoiceAt?.toISOString() ?? null,
    plain: { ...plain, total: plain.private + plain.public + plain.password },
    /** False while the browser must first convert folders or tags. */
    libraryReady: ready,
    jobs: {
      waiting: count('pending'),
      running: count('processing'),
      failed: count('failed'),
      encrypted: count('encrypted'),
      skipped: count('skipped'),
    },
    // A file that failed is still plain, so the server has its name.
    failed: failed.map((job) => ({
      fileId: job.fileId,
      name: names.get(job.fileId) ?? null,
      code: (job.errorCode ?? 'internal_error') as FileEncryptionErrorCode,
    })),
    /** Files that had a server-side password and wait for a new one. */
    passwordPending,
  }
}

export type ExistingFilesStatus = Awaited<
  ReturnType<typeof existingFilesStatus>
>
