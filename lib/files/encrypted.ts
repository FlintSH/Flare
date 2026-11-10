import type { Prisma } from '@prisma/client'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'

import { isE2eeError } from '@/lib/e2ee/errors'
import { HEADER_LENGTH, fileLayout, parseHeader } from '@/lib/e2ee/file'
import { base64urlDecode, base64urlEncode } from '@/lib/e2ee/primitives'
import { decodeStoredRecord } from '@/lib/e2ee/records'
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

export const encryptedRecordsSchema = z.strictObject(encryptedRecordFields)
export type EncryptedRecordsWire = z.infer<typeof encryptedRecordsSchema>

export const passwordStanzaSchema = encryptedRecordFields.passwordStanza

export interface EncryptedRecords {
  header: Uint8Array<ArrayBuffer>
  sealedMetadata: Uint8Array<ArrayBuffer>
  accountStanza: Uint8Array<ArrayBuffer>
  stanzaAccountPublicKey: Uint8Array<ArrayBuffer>
  passwordStanza: Uint8Array<ArrayBuffer> | null
}

export class EncryptedUploadError extends HttpError {
  /** `code` goes into the error body, for a script client to act on. */
  constructor(message: string, status = 400, code?: string) {
    super(status, message, code ? { body: { code } } : {})
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
    if (error.reason === 'unknown_version')
      throw new EncryptedUploadError(
        `${what} has a version this server does not accept.`,
        400,
        'protocol_version_not_accepted'
      )
    throw new EncryptedUploadError(`${what} is not valid.`)
  }
}

export function parsePasswordStanza(text: string): Uint8Array<ArrayBuffer> {
  const stanza = bytes(text, 'The password stanza')
  checked('The password stanza', () =>
    decodeStoredRecord('password_stanza', stanza)
  )
  return stanza
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
      409,
      'account_keys_missing'
    )
  if (
    accountPublicKey.length !== records.stanzaAccountPublicKey.length ||
    !records.stanzaAccountPublicKey.every(
      (byte, index) => accountPublicKey[index] === byte
    )
  )
    // A script client reads the code and asks for a new configuration
    // (section 8.3.6).
    throw new EncryptedUploadError(
      'The upload was encrypted for a different account key. Reload the page and try again. A tool needs a new configuration.',
      409,
      'account_key_not_current'
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
