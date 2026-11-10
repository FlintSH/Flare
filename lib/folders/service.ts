import type { Prisma } from '@prisma/client'
import { randomBytes } from 'node:crypto'

import { lockUserRow } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import type {
  FileFolderStanzasInput,
  FolderInput,
  FolderKeysInput,
  FolderUpdate,
  FolderView,
} from '@/lib/folders/schema'
import { HttpError } from '@/lib/http/errors'
import { nameKey } from '@/lib/library/names'
import { sameStoredBytes, wireBytes } from '@/lib/library/sealed-fields'

export class FolderError extends HttpError {
  constructor(
    message: string,
    status = 400,
    body: Record<string, unknown> = {}
  ) {
    super(status, message, { body })
    this.name = 'FolderError'
  }
}

/** A folder that has keys stores this in place of its name (section 9.4.1). */
export const sealedNameKey = (id: string) => `/sealed/${id}`

const KEYS_REQUIRED =
  'This account keeps folder names encrypted. Create and rename folders in Flare, in a browser where your keys are unlocked.'
const STALE_PARENT_KEY =
  'The keys of the parent folder changed. Reload the page and try again.'

export const folderViewSelect = {
  id: true,
  name: true,
  parentId: true,
  shareToken: true,
  folderPublicKey: true,
  sealedFolderMetadata: true,
  sealedFolderPrivateKey: true,
  parentFolderStanza: true,
  parentStanzaPublicKey: true,
  rekeyPending: true,
  _count: { select: { files: true } },
} satisfies Prisma.VaultFolderSelect

export function folderView(
  folder: Prisma.VaultFolderGetPayload<{ select: typeof folderViewSelect }>
): FolderView {
  return {
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    shareToken: folder.shareToken,
    fileCount: folder._count.files,
    keys:
      folder.folderPublicKey &&
      folder.sealedFolderMetadata &&
      folder.sealedFolderPrivateKey
        ? {
            folderPublicKey: wireBytes(folder.folderPublicKey)!,
            sealedFolderMetadata: wireBytes(folder.sealedFolderMetadata)!,
            sealedFolderPrivateKey: wireBytes(folder.sealedFolderPrivateKey)!,
            parentFolderStanza: wireBytes(folder.parentFolderStanza),
            parentStanzaPublicKey: wireBytes(folder.parentStanzaPublicKey),
            rekeyPending: folder.rekeyPending,
          }
        : null,
  }
}

export async function listFolders(userId: string) {
  const folders = await prisma.vaultFolder.findMany({
    where: { userId },
    // The server cannot order sealed names: the client sorts what it opens.
    orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
    select: folderViewSelect,
  })
  return folders.map(folderView)
}

/** The caller must hold the owner's row lock when using this before a write. */
export async function validateOwnedFolderId(
  userId: string,
  folderId: string | null,
  transaction?: Prisma.TransactionClient
): Promise<string | null> {
  if (folderId === null) return null
  const folder = await (transaction ?? prisma).vaultFolder.findFirst({
    where: { id: folderId, userId },
    select: { id: true },
  })
  if (!folder) throw new FolderError('Folder not found.', 404)
  return folder.id
}

/**
 * Adds a folder in the caller's transaction, which holds the owner's row lock
 * and has checked that the parent is theirs. `name` is already normalized.
 */
export function insertFolder<Select extends Prisma.VaultFolderSelect>(
  tx: Prisma.TransactionClient,
  userId: string,
  { name, parentId }: { name: string; parentId: string | null },
  select: Select
) {
  return tx.vaultFolder.create({
    data: { userId, name, normalizedName: nameKey(name), parentId },
    select,
  })
}

/** Whether the account completed key setup. Its folders then store no names. */
async function accountHasKeys(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { accountPublicKey: true },
  })
  return Boolean(user?.accountPublicKey)
}

export async function createFolder(userId: string, input: FolderInput) {
  return prisma.$transaction(async (tx) => {
    await lockUserRow(tx, userId)
    const keyed = await accountHasKeys(tx, userId)
    if (!('folderPublicKey' in input)) {
      if (keyed) throw new FolderError(KEYS_REQUIRED, 409)
      await validateOwnedFolderId(userId, input.parentId, tx)
      return folderView(await insertFolder(tx, userId, input, folderViewSelect))
    }
    if (!keyed)
      throw new FolderError(
        'Set up your encryption keys before creating folders with keys.',
        409
      )
    const parent = input.parentId
      ? await tx.vaultFolder.findFirst({
          where: { id: input.parentId, userId },
          select: { id: true, folderPublicKey: true, rekeyPending: true },
        })
      : null
    if (input.parentId && !parent)
      throw new FolderError('Folder not found.', 404)
    // A stanza is for the key the parent has now (section 8.4.2). A parent
    // that has no keys yet, or waits for new ones, gets the stanza later
    // from the repairs of the owner's browser.
    const stanza =
      input.parentFolderStanza && input.parentFolderPublicKey
        ? {
            stanza: input.parentFolderStanza,
            publicKey: input.parentFolderPublicKey,
          }
        : null
    if (stanza) {
      if (!parent)
        throw new FolderError('A folder without a parent has no parent stanza.')
      if (
        parent.rekeyPending ||
        !sameStoredBytes(parent.folderPublicKey, stanza.publicKey)
      )
        throw new FolderError(STALE_PARENT_KEY, 409, {
          code: 'stale_folder_key',
        })
    }
    // The row needs its ID for the sealed name key: make the ID here.
    const id = `f${randomBytes(12).toString('hex')}`
    const folder = await tx.vaultFolder.create({
      data: {
        id,
        userId,
        name: '',
        normalizedName: sealedNameKey(id),
        parentId: parent?.id ?? null,
        folderPublicKey: input.folderPublicKey,
        sealedFolderMetadata: input.sealedFolderMetadata,
        sealedFolderPrivateKey: input.sealedFolderPrivateKey,
        parentFolderStanza: stanza?.stanza ?? null,
        parentStanzaPublicKey: stanza?.publicKey ?? null,
      },
      select: folderViewSelect,
    })
    return folderView(folder)
  })
}

/** The folder and every folder below it. */
async function subtreeIds(
  tx: Prisma.TransactionClient,
  userId: string,
  rootId: string
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE tree AS (
      SELECT "id" FROM "VaultFolder" WHERE "id" = ${rootId} AND "userId" = ${userId}
      UNION
      SELECT child."id" FROM "VaultFolder" child
        JOIN tree ON child."parentId" = tree."id"
      WHERE child."userId" = ${userId}
    )
    SELECT "id" FROM tree`
  return rows.map((row) => row.id)
}

export async function updateFolder(
  userId: string,
  id: string,
  input: FolderUpdate
) {
  return prisma.$transaction(async (tx) => {
    await lockUserRow(tx, userId)
    const current = await tx.vaultFolder.findFirst({
      where: { id, userId },
      select: {
        id: true,
        shareToken: true,
        folderPublicKey: true,
        rekeyPending: true,
      },
    })
    if (!current) throw new FolderError('Folder not found.', 404)
    const keyed = Boolean(current.folderPublicKey)
    if (input.name !== undefined && keyed)
      throw new FolderError(
        'This folder keeps its name encrypted. Send a sealed name.'
      )
    if (input.name !== undefined && (await accountHasKeys(tx, userId)))
      throw new FolderError(KEYS_REQUIRED, 409)
    if (input.sealedFolderMetadata !== undefined && !keyed)
      throw new FolderError('This folder has no keys yet.', 409)
    if (input.sharing === true && current.rekeyPending)
      throw new FolderError(
        'This folder is still getting new keys after sharing stopped. Open Flare where your keys are unlocked, then share it again.',
        409,
        { code: 'rekey_pending' }
      )
    const stopSharing = input.sharing === false && current.shareToken !== null
    const folder = await tx.vaultFolder.update({
      where: { id, userId },
      data: {
        ...(input.name !== undefined
          ? { name: input.name, normalizedName: nameKey(input.name) }
          : {}),
        ...(input.sealedFolderMetadata !== undefined
          ? { sealedFolderMetadata: input.sealedFolderMetadata }
          : {}),
        ...(input.sharing !== undefined
          ? {
              shareToken: input.sharing
                ? (current.shareToken ?? randomBytes(32).toString('base64url'))
                : null,
            }
          : {}),
      },
      select: folderViewSelect,
    })
    if (stopSharing && keyed) {
      // Section 9.4.5, steps 2 and 3: the link carried the private key of
      // this folder, which opens every folder below it. Each of them waits
      // for a new key pair from the owner's browser.
      await tx.vaultFolder.updateMany({
        where: {
          userId,
          id: { in: await subtreeIds(tx, userId, id) },
          folderPublicKey: { not: null },
        },
        data: { rekeyPending: true },
      })
      return {
        ...folderView(folder),
        keys: { ...folderView(folder).keys!, rekeyPending: true },
      }
    }
    return folderView(folder)
  })
}

/** Dissolve a folder, moving its direct contents up one level without deleting files. */
export async function deleteFolder(userId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    await lockUserRow(tx, userId)
    const folder = await tx.vaultFolder.findFirst({
      where: { id, userId },
      select: { id: true, parentId: true, folderPublicKey: true },
    })
    if (!folder) throw new FolderError('Folder not found.', 404)
    const children = await tx.vaultFolder.findMany({
      where: { userId, parentId: id },
      select: { normalizedName: true },
    })
    if (children.length) {
      // Sealed names are never equal to the server: only plain names can
      // collide here. The client checks the names it can read.
      const conflict = await tx.vaultFolder.findFirst({
        where: {
          userId,
          parentId: folder.parentId,
          id: { not: id },
          normalizedName: { in: children.map((child) => child.normalizedName) },
        },
        select: { id: true },
      })
      if (conflict)
        throw new FolderError(
          'A subfolder has the same name as a folder one level up. Rename it before deleting this folder.',
          409
        )
      // A child may have the same name as this folder. Release the name before
      // reparenting it; slash-containing names cannot be created through the API.
      if (!folder.folderPublicKey)
        await tx.vaultFolder.update({
          where: { id, userId },
          data: { normalizedName: `/deleted/${id}` },
        })
      // A parent stanza is for the key of the folder that goes away. The
      // owner's browser makes one for the new parent (section 9.4.4).
      await tx.vaultFolder.updateMany({
        where: { userId, parentId: id },
        data: {
          parentId: folder.parentId,
          parentFolderStanza: null,
          parentStanzaPublicKey: null,
        },
      })
    }
    // The trigger drops the folder stanza of each file that moves.
    await tx.file.updateMany({
      where: { userId, folderId: id },
      data: { folderId: folder.parentId },
    })
    await tx.vaultFolder.delete({ where: { id, userId } })
  })
}

export async function moveFilesToFolder(
  userId: string,
  input: { fileIds: string[]; folderId: string | null }
): Promise<number> {
  const fileIds = [...new Set(input.fileIds)]
  return prisma.$transaction(async (tx) => {
    await lockUserRow(tx, userId)
    await validateOwnedFolderId(userId, input.folderId, tx)
    const ownedFiles = await tx.file.count({
      where: { id: { in: fileIds }, userId },
    })
    if (ownedFiles !== fileIds.length)
      throw new FolderError('One or more files are unavailable.', 404)
    // The trigger drops the folder stanza of each file that changes folder
    // (section 9.4.4). The owner's browser makes the new one.
    const changed = await tx.file.updateMany({
      where: { id: { in: fileIds }, userId },
      data: { folderId: input.folderId },
    })
    // Files can also be removed by expiry workers; roll back partial moves.
    if (changed.count !== fileIds.length)
      throw new FolderError('One or more files are unavailable.', 404)
    return changed.count
  })
}

/**
 * Stores key pairs and parent stanzas that the owner's browser made
 * (sections 8.4.2 and 9.4.5). A folder takes a key pair only when it has
 * none, which converts a folder from before encryption and deletes its plain
 * name, or when it waits for new keys after sharing stopped. Everything that
 * was made for the old key is deleted in the same transaction.
 */
export async function storeFolderKeys(userId: string, input: FolderKeysInput) {
  return prisma.$transaction(async (tx) => {
    await lockUserRow(tx, userId)
    if (!(await accountHasKeys(tx, userId)))
      throw new FolderError('Set up your encryption keys first.', 409)
    const ids = [
      ...new Set([
        ...input.folders.map((entry) => entry.id),
        ...input.parentStanzas.map((entry) => entry.id),
      ]),
    ]
    if (
      new Set(input.folders.map((entry) => entry.id)).size !==
      input.folders.length
    )
      throw new FolderError('A folder appears more than one time.')
    const owned = await tx.vaultFolder.findMany({
      where: { userId, id: { in: ids } },
      select: { id: true, folderPublicKey: true, rekeyPending: true },
    })
    if (owned.length !== ids.length)
      throw new FolderError('Folder not found.', 404)
    const state = new Map(owned.map((folder) => [folder.id, folder]))
    for (const entry of input.folders) {
      const current = state.get(entry.id)!
      if (current.folderPublicKey && !current.rekeyPending)
        throw new FolderError(
          'This folder already has keys. They change only after sharing stops.',
          409,
          { code: 'keys_exist' }
        )
      await tx.vaultFolder.update({
        where: { id: entry.id, userId },
        data: {
          name: '',
          normalizedName: sealedNameKey(entry.id),
          folderPublicKey: entry.folderPublicKey,
          sealedFolderMetadata: entry.sealedFolderMetadata,
          sealedFolderPrivateKey: entry.sealedFolderPrivateKey,
          parentFolderStanza: null,
          parentStanzaPublicKey: null,
          rekeyPending: false,
        },
      })
      // Stanzas for the old public key open nothing that is still valid.
      await tx.vaultFolder.updateMany({
        where: { userId, parentId: entry.id },
        data: { parentFolderStanza: null, parentStanzaPublicKey: null },
      })
      await tx.file.updateMany({
        where: { userId, folderId: entry.id, folderStanza: { not: null } },
        data: { folderStanza: null, folderStanzaPublicKey: null },
      })
    }
    // The plain names of these folders leave the audit records that were
    // written while the server had them (section 9.4.1).
    if (ids.length)
      await tx.$executeRaw`
        UPDATE "AuditEvent" SET "targetName" = NULL,
          details = details #- '{before,name}' #- '{after,name}'
        WHERE "targetType" = 'folder' AND "targetId" = ANY(${ids})`
    for (const entry of input.parentStanzas) {
      const folder = await tx.vaultFolder.findFirst({
        where: { id: entry.id, userId },
        select: {
          folderPublicKey: true,
          rekeyPending: true,
          parent: { select: { folderPublicKey: true, rekeyPending: true } },
        },
      })
      if (!folder?.folderPublicKey || folder.rekeyPending || !folder.parent)
        throw new FolderError(
          'A parent stanza needs a folder with keys inside another folder.',
          409
        )
      if (
        folder.parent.rekeyPending ||
        !sameStoredBytes(
          folder.parent.folderPublicKey,
          entry.parentFolderPublicKey
        )
      )
        throw new FolderError(STALE_PARENT_KEY, 409, {
          code: 'stale_folder_key',
        })
      await tx.vaultFolder.update({
        where: { id: entry.id, userId },
        data: {
          parentFolderStanza: entry.parentFolderStanza,
          parentStanzaPublicKey: entry.parentFolderPublicKey,
        },
      })
    }
    return {
      folders: input.folders.length,
      parentStanzas: input.parentStanzas.length,
    }
  })
}

/**
 * Stores folder stanzas of files (section 8.4.3). Each one must be for a
 * public encrypted file of the owner, and for the key that the file's folder
 * has now. An entry that is not is skipped and reported: the file may have
 * moved or become private since the browser made the stanza.
 */
export async function storeFileFolderStanzas(
  userId: string,
  input: FileFolderStanzasInput
) {
  return prisma.$transaction(async (tx) => {
    await lockUserRow(tx, userId)
    const files = await tx.file.findMany({
      where: { userId, id: { in: input.stanzas.map((entry) => entry.fileId) } },
      select: {
        id: true,
        encrypted: true,
        unreadable: true,
        visibility: true,
        folder: { select: { folderPublicKey: true, rekeyPending: true } },
      },
    })
    const byId = new Map(files.map((file) => [file.id, file]))
    const skipped: string[] = []
    let stored = 0
    for (const entry of input.stanzas) {
      const file = byId.get(entry.fileId)
      if (
        !file?.encrypted ||
        file.unreadable ||
        file.visibility !== 'PUBLIC' ||
        !file.folder ||
        file.folder.rekeyPending ||
        !sameStoredBytes(file.folder.folderPublicKey, entry.folderPublicKey)
      ) {
        skipped.push(entry.fileId)
        continue
      }
      await tx.file.update({
        where: { id: entry.fileId },
        data: {
          folderStanza: entry.folderStanza,
          folderStanzaPublicKey: entry.folderPublicKey,
        },
      })
      stored++
    }
    return { stored, skipped }
  })
}

/** The most files one repairs answer lists. The browser asks again for more. */
export const REPAIR_FILE_LIMIT = 100

/**
 * What the owner's browser must make for the folders of the account
 * (sections 8.4, 9.4.4 and 9.4.5): key pairs for folders from before
 * encryption and for folders whose sharing stopped, parent stanzas for
 * folders that moved or whose parent has new keys, and folder stanzas for
 * public encrypted files that have none for the key of their folder. A
 * moderator, the expiry worker and a script client can each leave such work.
 */
export async function folderRepairs(
  userId: string,
  after: string | null = null
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountPublicKey: true },
  })
  if (!user?.accountPublicKey)
    return { folderKeys: [], parentStanzas: [], fileStanzas: [], more: false }
  const folderKeys = await prisma.vaultFolder.findMany({
    where: { userId, OR: [{ folderPublicKey: null }, { rekeyPending: true }] },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  const parentStanzas = await prisma.$queryRaw<
    { id: string; parentId: string }[]
  >`
    SELECT child."id", child."parentId"
    FROM "VaultFolder" child
    JOIN "VaultFolder" parent ON parent."id" = child."parentId"
    WHERE child."userId" = ${userId}
      AND child."folderPublicKey" IS NOT NULL AND NOT child."rekeyPending"
      AND parent."folderPublicKey" IS NOT NULL AND NOT parent."rekeyPending"
      AND child."parentStanzaPublicKey" IS DISTINCT FROM parent."folderPublicKey"
    ORDER BY child."id"`
  const files = await prisma.$queryRaw<
    {
      id: string
      folderId: string
      header: Uint8Array
      sealedMetadata: Uint8Array
      accountStanza: Uint8Array
      stanzaAccountPublicKey: Uint8Array
      passwordStanza: Uint8Array | null
    }[]
  >`
    SELECT f."id", f."vaultFolderId" AS "folderId", f."header",
      f."sealedMetadata", f."accountStanza", f."stanzaAccountPublicKey",
      f."passwordStanza"
    FROM "File" f
    JOIN "VaultFolder" folder ON folder."id" = f."vaultFolderId"
    WHERE f."userId" = ${userId} AND f."encrypted" AND NOT f."unreadable"
      AND f."visibility" = 'PUBLIC'
      AND folder."folderPublicKey" IS NOT NULL AND NOT folder."rekeyPending"
      AND f."folderStanzaPublicKey" IS DISTINCT FROM folder."folderPublicKey"
      AND f."id" > ${after ?? ''}
    ORDER BY f."id"
    LIMIT ${REPAIR_FILE_LIMIT + 1}`
  return {
    folderKeys: folderKeys.map((folder) => folder.id),
    parentStanzas,
    fileStanzas: files.slice(0, REPAIR_FILE_LIMIT).map((file) => ({
      id: file.id,
      folderId: file.folderId,
      header: wireBytes(file.header)!,
      sealedMetadata: wireBytes(file.sealedMetadata)!,
      accountStanza: wireBytes(file.accountStanza)!,
      stanzaAccountPublicKey: wireBytes(file.stanzaAccountPublicKey)!,
      passwordStanza: wireBytes(file.passwordStanza),
    })),
    more: files.length > REPAIR_FILE_LIMIT,
  }
}
