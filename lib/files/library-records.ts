import type { FileVisibility, Prisma } from '@prisma/client'
import { z } from 'zod'

import { prisma } from '@/lib/database/prisma'
import { HttpError } from '@/lib/http/errors'
import {
  sameStoredBytes,
  storedRecordField,
  wireBytes,
} from '@/lib/library/sealed-fields'

import {
  type EncryptedRecords,
  EncryptedUploadError,
  RULE_TAG_LIMIT,
  SEALED_OCR_TEXT_MAX_BYTES,
  SEALED_THUMBNAIL_MAX_BYTES,
  encryptedRecordSelect,
  encryptedRecordsWire,
} from './encrypted'

/**
 * The library records of a file and the work that waits for the browser of
 * its owner (docs/e2ee-spec.md, sections 8.4.3, 9.6, 9.7 and 12.1). The
 * server stores sealed records and flags. It never opens a record, and it
 * takes a sealed text or thumbnail only in the upload request of the file
 * or from a session of the owner (sections 9.6.3 and 12.1).
 */

/** How many times the browser may fail on one file before the server stops listing it. */
export const PENDING_ATTEMPT_LIMIT = 3
/** The most files one pending answer lists. */
export const PENDING_PAGE_SIZE = 20

type Tx = Prisma.TransactionClient

/** Whether the account has a tag whose rule only a browser can read. */
export async function accountHasSealedTags(
  tx: Pick<Tx, 'vaultTag'>,
  userId: string
) {
  return Boolean(
    await tx.vaultTag.findFirst({
      where: { userId, sealedTagMetadata: { not: null } },
      select: { id: true },
    })
  )
}

/**
 * What a new file stores beside its upload records. The flags follow from
 * what the uploader declares (section 9.7), whichever credential it used:
 *
 * - `rulesPending`: the account has a sealed tag, and the client did not
 *   say that it applied the tag rules. A plain upload never says so.
 * - `ocrPending`: an encrypted image without text, while the instance
 *   reads images automatically.
 * - `thumbnailPending`: an encrypted file without a thumbnail, unless the
 *   client says that none can be made.
 */
export async function newFileLibraryState(
  tx: Tx,
  input: {
    userId: string
    records: EncryptedRecords | null
    visibility: FileVisibility
    folderId: string | null
    automaticOcr: boolean
  }
) {
  const sealedTags = await accountHasSealedTags(tx, input.userId)
  const library = input.records?.library ?? null
  if (!library)
    return {
      columns: { rulesPending: sealedTags },
      sealed: null,
      ruleTagIds: [] as string[],
    }
  if (library.folderStanza) {
    // Section 8.4.3: a private file must not have a folder stanza, and a
    // stanza for a key that the folder no longer has opens nothing.
    if (input.visibility !== 'PUBLIC')
      throw new EncryptedUploadError(
        'A private file cannot have a folder stanza.'
      )
    const folder = input.folderId
      ? await tx.vaultFolder.findFirst({
          where: { id: input.folderId, userId: input.userId },
          select: { folderPublicKey: true, rekeyPending: true },
        })
      : null
    if (!folder)
      throw new EncryptedUploadError(
        'A folder stanza needs a file that is in a folder.'
      )
    if (
      folder.rekeyPending ||
      !sameStoredBytes(
        folder.folderPublicKey,
        library.folderStanza.folderPublicKey
      )
    )
      throw new HttpError(
        409,
        'The keys of this folder changed. Reload the page, or install a new configuration for your upload tool, and try again.',
        { body: { code: 'stale_folder_key' } }
      )
  }
  return {
    columns: {
      folderStanza: library.folderStanza?.stanza ?? null,
      folderStanzaPublicKey: library.folderStanza?.folderPublicKey ?? null,
      rulesPending: sealedTags && !library.rulesApplied,
      ocrPending:
        input.automaticOcr && library.isImage && !library.sealedOcrText,
      thumbnailPending: !library.sealedThumbnail && !library.noThumbnail,
    },
    sealed:
      library.sealedOcrText || library.sealedThumbnail
        ? {
            sealedOcrText: library.sealedOcrText,
            sealedThumbnail: library.sealedThumbnail,
          }
        : null,
    ruleTagIds: library.ruleTagIds,
  }
}

/** Adds the tags that the rules of the owner gave. Unknown IDs are left out; removals by hand stay. */
export async function applyRuleTags(
  tx: Tx,
  file: { id: string; userId: string },
  tagIds: string[]
) {
  if (!tagIds.length) return 0
  const owned = await tx.vaultTag.findMany({
    where: { userId: file.userId, id: { in: tagIds } },
    select: { id: true },
  })
  if (!owned.length) return 0
  const result = await tx.vaultFileTag.createMany({
    data: owned.map((tag) => ({ fileId: file.id, tagId: tag.id })),
    skipDuplicates: true,
  })
  return result.count
}

export async function storeSealedData(
  tx: Tx,
  fileId: string,
  sealed: {
    sealedOcrText?: Uint8Array<ArrayBuffer> | null
    sealedThumbnail?: Uint8Array<ArrayBuffer> | null
  }
) {
  const data = {
    ...(sealed.sealedOcrText ? { sealedOcrText: sealed.sealedOcrText } : {}),
    ...(sealed.sealedThumbnail
      ? { sealedThumbnail: sealed.sealedThumbnail }
      : {}),
  }
  if (!Object.keys(data).length) return
  await tx.fileSealedData.upsert({
    where: { fileId },
    create: { fileId, ...data },
    update: data,
  })
}

/**
 * What the browser of the owner reports for one file (section 9.7). Strict:
 * a field such as plain text would be a client that leaks by mistake.
 */
export const fileWorkSchema = z
  .strictObject({
    sealedOcrText: storedRecordField(
      'sealed_ocr_text',
      SEALED_OCR_TEXT_MAX_BYTES
    ).optional(),
    /** `none`: this file has no text to read, for example it is not an image. */
    ocr: z.literal('none').optional(),
    sealedThumbnail: storedRecordField(
      'sealed_thumbnail',
      SEALED_THUMBNAIL_MAX_BYTES
    ).optional(),
    /** `none`: no thumbnail can be made for this file. */
    thumbnail: z.literal('none').optional(),
    /** The client applied the tag rules of the owner. */
    rulesApplied: z.literal(true).optional(),
    ruleTagIds: z
      .array(z.string().min(1).max(128))
      .max(RULE_TAG_LIMIT)
      .optional(),
    /** The work failed in this browser. The server counts the attempt. */
    failed: z.literal(true).optional(),
  })
  .refine(
    (input) => !(input.sealedOcrText && input.ocr),
    'Send a sealed text or say that there is none, not both.'
  )
  .refine(
    (input) => !(input.sealedThumbnail && input.thumbnail),
    'Send a sealed thumbnail or say that there is none, not both.'
  )
  .refine(
    (input) => input.ruleTagIds === undefined || input.rulesApplied === true,
    'Rule tags come with rulesApplied.'
  )
  .refine(
    (input) => Object.keys(input).length > 0,
    'Report the work that was done.'
  )

export type FileWork = z.infer<typeof fileWorkSchema>

/** Stores the result of work on one file of the owner and clears its flags. */
export async function recordFileWork(
  userId: string,
  fileId: string,
  work: FileWork
) {
  return prisma.$transaction(async (tx) => {
    const file = await tx.file.findFirst({
      where: { id: fileId, userId },
      select: { id: true, userId: true, encrypted: true, unreadable: true },
    })
    if (!file) throw new HttpError(404, 'File not found')
    const sealed =
      work.sealedOcrText || work.sealedThumbnail || work.ocr || work.thumbnail
    if (sealed && !file.encrypted)
      throw new HttpError(
        400,
        'A plain file takes no sealed text and no sealed thumbnail.'
      )
    if (sealed && file.unreadable)
      throw new HttpError(409, 'No key of this account opens this file.')
    await storeSealedData(tx, file.id, work)
    if (work.rulesApplied) await applyRuleTags(tx, file, work.ruleTagIds ?? [])
    // A new text can match a tag rule on text. A client that stores the
    // text without the rules leaves them for the background work.
    const rulesWait =
      Boolean(work.sealedOcrText) &&
      !work.rulesApplied &&
      (await accountHasSealedTags(tx, userId))
    return tx.file.update({
      where: { id: file.id },
      data: {
        ...(rulesWait ? { rulesPending: true } : {}),
        ...(work.sealedOcrText || work.ocr ? { ocrPending: false } : {}),
        ...(work.sealedThumbnail || work.thumbnail
          ? { thumbnailPending: false }
          : {}),
        ...(work.rulesApplied ? { rulesPending: false } : {}),
        pendingAttempts: work.failed ? { increment: 1 } : 0,
      },
      select: {
        id: true,
        rulesPending: true,
        ocrPending: true,
        thumbnailPending: true,
      },
    })
  })
}

const pendingSelect = {
  id: true,
  name: true,
  mimeType: true,
  urlPath: true,
  size: true,
  ocrText: true,
  isOcrProcessed: true,
  rulesPending: true,
  ocrPending: true,
  thumbnailPending: true,
  ...encryptedRecordSelect,
  sealedData: { select: { sealedOcrText: true } },
} satisfies Prisma.FileSelect

/**
 * The files of the owner that wait for work, oldest first, and how many
 * wait in all. A file that failed `PENDING_ATTEMPT_LIMIT` times is left
 * out, so a browser never loops on it.
 */
export async function listPendingWork(
  userId: string,
  /** Lists the files after this ID, so a browser can pass ones it failed on. */
  after: string | null = null
) {
  const where: Prisma.FileWhereInput = {
    userId,
    unreadable: false,
    pendingAttempts: { lt: PENDING_ATTEMPT_LIMIT },
    OR: [
      { rulesPending: true },
      { ocrPending: true },
      { thumbnailPending: true },
    ],
  }
  const [total, files] = await Promise.all([
    prisma.file.count({ where }),
    prisma.file.findMany({
      where: { ...where, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: 'asc' },
      take: PENDING_PAGE_SIZE,
      select: pendingSelect,
    }),
  ])
  return {
    total,
    files: files.map((file) => {
      const flags = {
        rulesPending: file.rulesPending,
        ocrPending: file.ocrPending,
        thumbnailPending: file.thumbnailPending,
      }
      const records = encryptedRecordsWire(file, { forOwner: true })
      return records
        ? {
            id: file.id,
            encrypted: true as const,
            urlPath: file.urlPath,
            size: file.size,
            ...flags,
            encryption: records,
            sealedOcrText: wireBytes(file.sealedData?.sealedOcrText),
          }
        : {
            id: file.id,
            encrypted: false as const,
            name: file.name,
            mimeType: file.mimeType,
            // The text the server read from a plain image, for rules on it.
            ocrText: file.ocrText,
            ocrProcessed: file.isOcrProcessed,
            ...flags,
          }
    }),
  }
}
