import { z } from 'zod'

import { BATCH_LIMIT } from '@/lib/library/contract'
import {
  PLAIN_NAME_MESSAGE,
  isPlainName,
  nameSchema,
} from '@/lib/library/names'
import {
  folderPublicKeyField,
  folderStanzaField,
  parentFolderStanzaField,
  sealedFolderMetadataField,
  sealedFolderPrivateKeyField,
} from '@/lib/library/sealed-fields'

export const FOLDER_NAME_MAX_LENGTH = 80

export const folderNameSchema = z
  .string()
  // Folder names have always refused control characters as typed, so a tab or
  // line break fails here where a tag name turns it into a space.
  .refine(isPlainName, PLAIN_NAME_MESSAGE)
  .pipe(nameSchema('folder', FOLDER_NAME_MAX_LENGTH))
  .refine(
    (name) => !/[\\/]/.test(name) && name !== '.' && name !== '..',
    'Choose a name without slashes; "." and ".." are reserved.'
  )

export const folderIdSchema = z.string().min(1).max(128)

/**
 * The key material of a folder as its owner's browser makes it
 * (docs/e2ee-spec.md, section 8.4.2). None of it is readable by the server.
 */
const folderKeyFields = {
  folderPublicKey: folderPublicKeyField,
  sealedFolderMetadata: sealedFolderMetadataField,
  sealedFolderPrivateKey: sealedFolderPrivateKeyField,
}

/**
 * The private key of a folder, encrypted to the public key of its parent,
 * with the parent key it was made for. The server refuses a stanza for a
 * key that the parent no longer has.
 */
const parentStanzaFields = {
  parentFolderStanza: parentFolderStanzaField,
  parentFolderPublicKey: folderPublicKeyField,
}

const plainFolderInputSchema = z
  .object({
    name: folderNameSchema,
    parentId: folderIdSchema.nullable().default(null),
  })
  .strict()

const keyedFolderInputSchema = z
  .strictObject({
    parentId: folderIdSchema.nullable().default(null),
    ...folderKeyFields,
    parentFolderStanza: parentStanzaFields.parentFolderStanza.optional(),
    parentFolderPublicKey: parentStanzaFields.parentFolderPublicKey.optional(),
  })
  .refine(
    (input) =>
      (input.parentFolderStanza === undefined) ===
      (input.parentFolderPublicKey === undefined),
    'A parent folder stanza needs the parent folder key it was made for.'
  )

/** A folder with a plain name, or a folder with keys and a sealed name. */
export const folderInputSchema = z.union([
  keyedFolderInputSchema,
  plainFolderInputSchema,
])

export const folderUpdateSchema = z
  .object({
    name: folderNameSchema.optional(),
    /** The new name of a folder that has keys. */
    sealedFolderMetadata: sealedFolderMetadataField.optional(),
    sharing: z.boolean().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.name !== undefined ||
      input.sealedFolderMetadata !== undefined ||
      input.sharing !== undefined,
    'Choose a name or sharing setting to update.'
  )
  .refine(
    (input) =>
      input.name === undefined || input.sealedFolderMetadata === undefined,
    'Send a name or a sealed name, not both.'
  )

/** The most folders or stanzas one key request carries. */
export const FOLDER_KEY_BATCH_LIMIT = 200

/**
 * `PUT /api/folders/keys`: key pairs for folders that have none yet or that
 * wait for new ones, and parent stanzas.
 */
export const folderKeysInputSchema = z
  .strictObject({
    folders: z
      .array(z.strictObject({ id: folderIdSchema, ...folderKeyFields }))
      .max(FOLDER_KEY_BATCH_LIMIT)
      .default([]),
    parentStanzas: z
      .array(z.strictObject({ id: folderIdSchema, ...parentStanzaFields }))
      .max(FOLDER_KEY_BATCH_LIMIT)
      .default([]),
  })
  .refine(
    (input) => input.folders.length + input.parentStanzas.length > 0,
    'Send folder keys or parent stanzas.'
  )

/** `PUT /api/files/folder-stanzas`: folder stanzas of public encrypted files. */
export const fileFolderStanzasInputSchema = z.strictObject({
  stanzas: z
    .array(
      z.strictObject({
        fileId: folderIdSchema,
        folderStanza: folderStanzaField,
        folderPublicKey: folderPublicKeyField,
      })
    )
    .min(1)
    .max(BATCH_LIMIT),
})

export const fileFoldersInputSchema = z
  .object({
    fileIds: z.array(folderIdSchema).min(1).max(BATCH_LIMIT),
    folderId: folderIdSchema.nullable(),
  })
  .strict()

export type FolderInput = z.infer<typeof folderInputSchema>
export type FolderUpdate = z.infer<typeof folderUpdateSchema>
export type FolderKeysInput = z.infer<typeof folderKeysInputSchema>
export type FileFolderStanzasInput = z.infer<
  typeof fileFolderStanzasInputSchema
>

/** The key records of a folder as a response carries them: base64url. */
export interface FolderKeyRecords {
  folderPublicKey: string
  sealedFolderMetadata: string
  sealedFolderPrivateKey: string
  parentFolderStanza: string | null
  /** The parent key that `parentFolderStanza` is for. */
  parentStanzaPublicKey: string | null
  /** Sharing stopped, and the owner's browser has not replaced the keys yet. */
  rekeyPending: boolean
}

export interface FolderView {
  id: string
  /** Empty for a folder that has keys: its name is in `keys`. */
  name: string
  parentId: string | null
  fileCount: number
  shareToken: string | null
  /** Null for a folder with a plain name. */
  keys?: FolderKeyRecords | null
}
