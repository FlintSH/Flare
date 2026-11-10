import type { Prisma } from '@prisma/client'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'

import { isE2eeError } from '@/lib/e2ee/errors'
import { HEADER_LENGTH, fileLayout, parseHeader } from '@/lib/e2ee/file'
import {
  base64urlDecode,
  base64urlEncode,
  isCanonicalX25519PublicKey,
} from '@/lib/e2ee/primitives'
import { type StoredRecordKind, decodeStoredRecord } from '@/lib/e2ee/records'
import { HttpError } from '@/lib/http/errors'

import { encryptedFileId } from './encrypted-id'

/**
 * The server side of an encrypted file (docs/e2ee-spec.md, sections 7 to
 * 11). The server stores ciphertext and records that only a client opens.
 * It never has a file key, a link secret, a file name or a file type, and
 * nothing here can decrypt. It checks only what is public: the magic value,
 * the lengths, and which account key the stanza is for.
 */

/** The name the database holds for an encrypted file: none. */
export const ENCRYPTED_FILE_NAME = ''
/** The type the database holds, and the type every response sends. */
export const ENCRYPTED_FILE_TYPE = 'application/octet-stream'
/** The file name of the one multipart part, and of a ciphertext download. */
export const ENCRYPTED_PART_NAME = 'encrypted'
/** What interfaces and events call a file whose name the server does not have. */
export const ENCRYPTED_FILE_LABEL = 'Encrypted file'
/** The request header that marks a single-request upload as encrypted. */
export const ENCRYPTED_UPLOAD_HEADER = 'x-flare-encrypted'

/**
 * A sealed name and type: 56 bytes of sealed box around a small JSON object.
 * 4096 bytes hold a 255-character name in any script and a full MIME type.
 */
const SEALED_METADATA_MAX_BYTES = 4096

/**
 * The sealed text of an image: 56 bytes of sealed box around UTF-8 text. The
 * client cuts longer text (docs/e2ee-spec.md, section 9.6.1).
 */
export const SEALED_OCR_TEXT_MAX_BYTES = 56 + 256 * 1024
/** A sealed WebP thumbnail with a longest side of 480 pixels (section 12.1). */
export const SEALED_THUMBNAIL_MAX_BYTES = 56 + 256 * 1024
/** The most tags that the rules of an account can add to one file in one request. */
export const RULE_TAG_LIMIT = 100

const base64url = (maxBytes: number) =>
  z
    .string()
    .min(1)
    .max(Math.ceil((maxBytes * 4) / 3) + 2)
    .regex(/^[A-Za-z0-9_-]+$/)

/**
 * The records of an encrypted upload, each base64url with its
 * `record_version` byte (section 4.4, rule 12).
 */
export const encryptedRecordFields = {
  header: base64url(HEADER_LENGTH),
  sealedMetadata: base64url(SEALED_METADATA_MAX_BYTES + 1),
  accountStanza: base64url(97),
  stanzaAccountPublicKey: base64url(32),
  passwordStanza: base64url(217).nullable().optional(),
}

/** A form sends text and a JSON body can send a boolean: both are read. */
const flag = z.union([z.boolean(), z.enum(['true', 'false'])])
const isSet = (value: boolean | 'true' | 'false' | undefined) =>
  value === true || value === 'true'

/**
 * What an encrypted upload can also carry (section 10.1, steps 5, 7 and 8):
 * the folder stanza with the folder key it is for, the sealed text and
 * thumbnail, the tags that the rules of the owner gave, and which work the
 * client did. Every value is a string, because a multipart form has no
 * other type.
 */
export const encryptedLibraryFields = {
  folderStanza: base64url(97).optional(),
  folderPublicKey: base64url(32).optional(),
  sealedOcrText: base64url(SEALED_OCR_TEXT_MAX_BYTES + 1).optional(),
  sealedThumbnail: base64url(SEALED_THUMBNAIL_MAX_BYTES + 1).optional(),
  /** Tag IDs: separated by commas, or a list in a JSON body. */
  ruleTagIds: z
    .union([
      z
        .string()
        .max(RULE_TAG_LIMIT * 130)
        .regex(/^[A-Za-z0-9_,-]*$/),
      z.array(z.string().min(1).max(128)).max(RULE_TAG_LIMIT),
    ])
    .optional(),
  /** The client applied the tag rules of the owner (section 9.7). */
  rulesApplied: flag.optional(),
  /** The file is an image, so it can have text (section 9.7). */
  isImage: flag.optional(),
  /** `none`: no thumbnail can be made for this file. */
  thumbnail: z.literal('none').optional(),
}

export const encryptedUploadFields = {
  ...encryptedRecordFields,
  ...encryptedLibraryFields,
}

export const encryptedRecordsSchema = z.strictObject(encryptedUploadFields)
export type EncryptedRecordsWire = z.infer<typeof encryptedRecordsSchema>

export const passwordStanzaSchema = encryptedRecordFields.passwordStanza

/** The library records and declarations of an encrypted upload. */
export interface EncryptedLibraryRecords {
  /** A folder stanza with the folder public key it was made for. */
  folderStanza: {
    stanza: Uint8Array<ArrayBuffer>
    folderPublicKey: Uint8Array<ArrayBuffer>
  } | null
  sealedOcrText: Uint8Array<ArrayBuffer> | null
  sealedThumbnail: Uint8Array<ArrayBuffer> | null
  ruleTagIds: string[]
  rulesApplied: boolean
  isImage: boolean
  /** The client says no thumbnail can exist. */
  noThumbnail: boolean
}

export interface EncryptedRecords {
  header: Uint8Array<ArrayBuffer>
  sealedMetadata: Uint8Array<ArrayBuffer>
  accountStanza: Uint8Array<ArrayBuffer>
  stanzaAccountPublicKey: Uint8Array<ArrayBuffer>
  passwordStanza: Uint8Array<ArrayBuffer> | null
  library: EncryptedLibraryRecords
}

export class EncryptedUploadError extends HttpError {
  constructor(message: string, status = 400) {
    super(status, message)
    this.name = 'EncryptedUploadError'
  }
}

function bytes(text: string, what: string): Uint8Array<ArrayBuffer> {
  try {
    return Uint8Array.from(base64urlDecode(text))
  } catch {
    throw new EncryptedUploadError(`${what} is not valid base64url.`)
  }
}

function checked<Result>(what: string, read: () => Result): Result {
  try {
    return read()
  } catch (error) {
    if (!isE2eeError(error)) throw error
    throw new EncryptedUploadError(
      error.reason === 'unknown_version'
        ? `${what} has a version this server does not accept.`
        : `${what} is not valid.`
    )
  }
}

export function parsePasswordStanza(text: string): Uint8Array<ArrayBuffer> {
  const stanza = bytes(text, 'The password stanza')
  checked('The password stanza', () =>
    decodeStoredRecord('password_stanza', stanza)
  )
  return stanza
}

/** A stored record of `kind` in its text form: `record_version || record`. */
export function parseStoredRecord(
  kind: StoredRecordKind,
  text: string,
  what: string,
  maxBytes?: number
): Uint8Array<ArrayBuffer> {
  const record = bytes(text, what)
  if (maxBytes !== undefined && record.length > maxBytes + 1)
    throw new EncryptedUploadError(`${what} is too large.`)
  checked(what, () => decodeStoredRecord(kind, record))
  return record
}

/** An X25519 public key in its canonical form (section 4.4, rule 3a). */
export function parseFolderPublicKey(text: string): Uint8Array<ArrayBuffer> {
  const key = bytes(text, 'The folder public key')
  if (key.length !== 32 || !isCanonicalX25519PublicKey(key))
    throw new EncryptedUploadError('The folder public key is not valid.')
  return key
}

/**
 * A folder stanza and the folder key it is for. The kind of stanza follows
 * from the file: a file with a password stanza takes a
 * `folder_link_secret_stanza`, each other file a `folder_file_stanza`
 * (section 8.4.3). Both have one length, and the server cannot tell them
 * apart; the name in a message is for the reader.
 */
export function parseFolderStanza(input: {
  folderStanza: string
  folderPublicKey: string
}): NonNullable<EncryptedLibraryRecords['folderStanza']> {
  return {
    stanza: parseStoredRecord(
      'folder_file_stanza',
      input.folderStanza,
      'The folder stanza'
    ),
    folderPublicKey: parseFolderPublicKey(input.folderPublicKey),
  }
}

export function parseSealedOcrText(text: string) {
  return parseStoredRecord(
    'sealed_ocr_text',
    text,
    'The sealed image text',
    SEALED_OCR_TEXT_MAX_BYTES
  )
}

export function parseSealedThumbnail(text: string) {
  return parseStoredRecord(
    'sealed_thumbnail',
    text,
    'The sealed thumbnail',
    SEALED_THUMBNAIL_MAX_BYTES
  )
}

function parseLibraryRecords(
  wire: EncryptedRecordsWire
): EncryptedLibraryRecords {
  if (Boolean(wire.folderStanza) !== Boolean(wire.folderPublicKey))
    throw new EncryptedUploadError(
      'A folder stanza needs the folder public key it was made for.'
    )
  const sentTagIds = wire.ruleTagIds ?? []
  const ruleTagIds = [
    ...new Set(
      (typeof sentTagIds === 'string'
        ? sentTagIds.split(',')
        : sentTagIds
      ).filter(Boolean)
    ),
  ]
  if (ruleTagIds.length > RULE_TAG_LIMIT)
    throw new EncryptedUploadError(
      `Rules can add up to ${RULE_TAG_LIMIT} tags to one file.`
    )
  if (wire.sealedThumbnail && wire.thumbnail)
    throw new EncryptedUploadError(
      'An upload has a thumbnail or says that none can be made, not both.'
    )
  return {
    folderStanza:
      wire.folderStanza && wire.folderPublicKey
        ? parseFolderStanza({
            folderStanza: wire.folderStanza,
            folderPublicKey: wire.folderPublicKey,
          })
        : null,
    sealedOcrText: wire.sealedOcrText
      ? parseSealedOcrText(wire.sealedOcrText)
      : null,
    sealedThumbnail: wire.sealedThumbnail
      ? parseSealedThumbnail(wire.sealedThumbnail)
      : null,
    ruleTagIds,
    rulesApplied: isSet(wire.rulesApplied),
    isImage: isSet(wire.isImage),
    noThumbnail: wire.thumbnail === 'none',
  }
}

/** Checks the form of each record. Nothing here proves that a record opens. */
export function parseEncryptedRecords(
  wire: EncryptedRecordsWire
): EncryptedRecords {
  const header = bytes(wire.header, 'The file header')
  checked('The file header', () => parseHeader(header))
  const sealedMetadata = bytes(wire.sealedMetadata, 'The sealed metadata')
  if (sealedMetadata.length > SEALED_METADATA_MAX_BYTES + 1)
    throw new EncryptedUploadError('The sealed metadata is too large.')
  checked('The sealed metadata', () =>
    decodeStoredRecord('sealed_metadata', sealedMetadata)
  )
  const accountStanza = bytes(wire.accountStanza, 'The account stanza')
  checked('The account stanza', () =>
    decodeStoredRecord('account_stanza', accountStanza)
  )
  const stanzaAccountPublicKey = bytes(
    wire.stanzaAccountPublicKey,
    'The account public key'
  )
  if (stanzaAccountPublicKey.length !== 32)
    throw new EncryptedUploadError('The account public key is not valid.')
  return {
    header,
    sealedMetadata,
    accountStanza,
    stanzaAccountPublicKey,
    passwordStanza: wire.passwordStanza
      ? parsePasswordStanza(wire.passwordStanza)
      : null,
    library: parseLibraryRecords(wire),
  }
}

/** A stored length that no encrypted file can have is refused (section 7.4). */
export function assertCiphertextLength(size: number) {
  checked('The size of the encrypted file', () => fileLayout(size))
}

/**
 * The stored bytes must start with the header the request named, and have a
 * length that an encrypted file can have (section 11.2).
 */
export function assertEncryptedBody(
  head: Uint8Array,
  size: number,
  records: EncryptedRecords
) {
  if (
    head.length < HEADER_LENGTH ||
    !records.header.every((byte, index) => head[index] === byte)
  )
    throw new EncryptedUploadError(
      'The uploaded bytes do not start with the file header of this upload.'
    )
  assertCiphertextLength(size)
}

/** A plain upload must not carry the bytes of an encrypted file by mistake. */
export function startsWithEncryptedMagic(head: Uint8Array) {
  if (head.length < HEADER_LENGTH) return false
  try {
    parseHeader(head.subarray(0, HEADER_LENGTH))
    return true
  } catch {
    return false
  }
}

/** The stanza must be for the account key the uploader has now (section 8.3.4). */
export function assertStanzaForAccount(
  records: EncryptedRecords,
  accountPublicKey: Uint8Array | null
) {
  if (!accountPublicKey)
    throw new EncryptedUploadError(
      'Set up your encryption keys before uploading encrypted files.',
      409
    )
  if (
    accountPublicKey.length !== records.stanzaAccountPublicKey.length ||
    !records.stanzaAccountPublicKey.every(
      (byte, index) => accountPublicKey[index] === byte
    )
  )
    throw new EncryptedUploadError(
      'The upload was encrypted for a different account key. Reload the page and try again.',
      409
    )
}

/** Where a new encrypted file is stored and addressed: no name in either. */
export function encryptedDestination(
  user: { urlId: string },
  objectId: string
) {
  const fileId = encryptedFileId(Uint8Array.from(randomBytes(16)))
  return {
    filePath: `uploads/${user.urlId}/${objectId}/${fileId}`,
    urlPath: `/${user.urlId}/${fileId}`,
    displayName: ENCRYPTED_FILE_NAME,
    urlSafeName: fileId,
  }
}

export const encryptedRecordSelect = {
  encrypted: true,
  header: true,
  sealedMetadata: true,
  accountStanza: true,
  stanzaAccountPublicKey: true,
  passwordStanza: true,
} satisfies Prisma.FileSelect

type StoredRecords = Prisma.FileGetPayload<{
  select: typeof encryptedRecordSelect
}>

const wire = (value: Uint8Array | null) =>
  value ? base64urlEncode(value) : null

/**
 * The records as an API sends them. `forOwner` adds the account stanza,
 * which only the owner's private key opens and only the owner needs.
 */
export function encryptedRecordsWire(
  file: StoredRecords,
  { forOwner }: { forOwner: boolean }
) {
  if (!file.encrypted || !file.header || !file.sealedMetadata) return null
  return {
    header: base64urlEncode(file.header),
    sealedMetadata: base64urlEncode(file.sealedMetadata),
    passwordStanza: wire(file.passwordStanza),
    ...(forOwner && {
      accountStanza: wire(file.accountStanza),
      stanzaAccountPublicKey: wire(file.stanzaAccountPublicKey),
    }),
  }
}

/** The name an audit record, an event or a log may carry: none for an encrypted file. */
export function auditFileName(file: { name: string; encrypted?: boolean }) {
  return file.encrypted || !file.name ? undefined : file.name
}
