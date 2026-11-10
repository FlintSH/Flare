import type { Prisma } from '@prisma/client'
import { z } from 'zod'

import { SecurityError } from '@/lib/auth/security/shared'
import {
  sealedFolderPrivateKeyField,
  sealedTagMetadataField,
  wireBytes,
} from '@/lib/library/sealed-fields'

// The records of the library that are sealed with a key from the account
// private key (docs/e2ee-spec.md, sections 8.4.2 and 9.5.1): the owner's copy
// of each folder private key and the name and rule of each tag. A rotation
// changes the account key, so the same request replaces all of them
// (section 8.3.3). A reset without the mnemonic loses them (section 6.9).

/** The most folders and tags one rotation request can carry. */
export const ROTATION_FOLDER_LIMIT = 5000
export const ROTATION_TAG_LIMIT = 2000
/** A rotation of an account with many folders and tags is larger than a key request. */
export const ROTATION_BODY_LIMIT = 4 * 1024 * 1024

const recordId = z.string().min(1).max(128)

/**
 * What a rotation request carries for the library: a new
 * `sealed_folder_private_key` for each folder that has keys, and a new
 * `sealed_tag_metadata` for each sealed tag.
 */
export const rotatedLibraryFields = {
  folders: z
    .array(
      z.strictObject({
        id: recordId,
        sealedFolderPrivateKey: sealedFolderPrivateKeyField,
      })
    )
    .max(ROTATION_FOLDER_LIMIT)
    .default([]),
  tags: z
    .array(
      z.strictObject({
        id: recordId,
        sealedTagMetadata: sealedTagMetadataField,
      })
    )
    .max(ROTATION_TAG_LIMIT)
    .default([]),
}

export const rotatedLibrarySchema = z.strictObject(rotatedLibraryFields)
export type RotatedLibrary = z.infer<typeof rotatedLibrarySchema>

const INCOMPLETE = new SecurityError(
  'This request does not have a new sealed record for each folder and each tag of the account. Reload the page and try again.',
  409,
  { body: { code: 'library_records_incomplete' } }
)

function sameIds(sent: { id: string }[], stored: { id: string }[]) {
  if (sent.length !== stored.length) return false
  const ids = new Set(sent.map((entry) => entry.id))
  return ids.size === sent.length && stored.every((entry) => ids.has(entry.id))
}

/**
 * Replaces the sealed records in the caller's transaction, which holds the
 * account's row lock. The request must cover exactly the folders that have
 * keys and the tags that are sealed: one that is left out would stay sealed
 * with a key that the account no longer has.
 */
export async function replaceLibraryRecords(
  tx: Prisma.TransactionClient,
  userId: string,
  library: RotatedLibrary
) {
  const [folders, tags] = await Promise.all([
    tx.vaultFolder.findMany({
      where: { userId, folderPublicKey: { not: null } },
      select: { id: true },
    }),
    tx.vaultTag.findMany({
      where: { userId, sealedTagMetadata: { not: null } },
      select: { id: true },
    }),
  ])
  if (!sameIds(library.folders, folders) || !sameIds(library.tags, tags))
    throw INCOMPLETE
  for (const folder of library.folders)
    await tx.vaultFolder.update({
      where: { id: folder.id, userId },
      data: { sealedFolderPrivateKey: folder.sealedFolderPrivateKey },
    })
  for (const tag of library.tags)
    await tx.vaultTag.update({
      where: { id: tag.id, userId },
      data: { sealedTagMetadata: tag.sealedTagMetadata },
    })
}

/**
 * The sealed records that a recovery re-seals, for a client that has the
 * email link and no session (section 6.8). All of it is ciphertext that only
 * the account key of the mnemonic opens.
 */
export async function sealedLibraryRecords(
  db: Pick<Prisma.TransactionClient, 'vaultFolder' | 'vaultTag'>,
  userId: string
) {
  const [folders, tags] = await Promise.all([
    db.vaultFolder.findMany({
      where: { userId, folderPublicKey: { not: null } },
      select: {
        id: true,
        folderPublicKey: true,
        sealedFolderMetadata: true,
        sealedFolderPrivateKey: true,
      },
      orderBy: { id: 'asc' },
    }),
    db.vaultTag.findMany({
      where: { userId, sealedTagMetadata: { not: null } },
      select: { id: true, sealedTagMetadata: true },
      orderBy: { id: 'asc' },
    }),
  ])
  return {
    folders: folders.map((folder) => ({
      id: folder.id,
      folderPublicKey: wireBytes(folder.folderPublicKey)!,
      sealedFolderMetadata: wireBytes(folder.sealedFolderMetadata)!,
      sealedFolderPrivateKey: wireBytes(folder.sealedFolderPrivateKey)!,
    })),
    tags: tags.map((tag) => ({
      id: tag.id,
      sealedTagMetadata: wireBytes(tag.sealedTagMetadata)!,
    })),
  }
}

/**
 * Step 4 of section 6.9 for the library, in the caller's transaction: no
 * key of the account opens its encrypted files any more, so each is marked
 * unreadable and stops waiting for work. The sealed names of folders and
 * tags are lost with the old key. Each folder that had keys and each sealed
 * tag gets a placeholder name and no keys, so the account can use it again:
 * the owner's browser gives it new keys at the next unlock. A shared folder
 * link carried a key that opens nothing now, so sharing stops.
 *
 * Plain files, and the share links of the files themselves, do not change.
 */
export async function resetLibraryRecords(
  tx: Prisma.TransactionClient,
  userId: string
) {
  await tx.$executeRaw`
    UPDATE "File"
    SET "unreadable" = true, "folderStanza" = NULL,
      "folderStanzaPublicKey" = NULL, "rulesPending" = false,
      "ocrPending" = false, "thumbnailPending" = false
    WHERE "userId" = ${userId} AND "encrypted"`
  await tx.$executeRaw`
    UPDATE "VaultFolder"
    SET "name" = 'Folder ' || right("id", 6),
      "normalizedName" = '/reset/' || "id",
      "folderPublicKey" = NULL, "sealedFolderMetadata" = NULL,
      "sealedFolderPrivateKey" = NULL, "parentFolderStanza" = NULL,
      "parentStanzaPublicKey" = NULL, "rekeyPending" = false,
      "shareToken" = NULL
    WHERE "userId" = ${userId} AND "folderPublicKey" IS NOT NULL`
  await tx.$executeRaw`
    UPDATE "VaultTag"
    SET "name" = 'Tag ' || right("id", 6),
      "normalizedName" = '/reset/' || "id",
      "sealedTagMetadata" = NULL
    WHERE "userId" = ${userId} AND "sealedTagMetadata" IS NOT NULL`
}
