import { CONTEXTS } from './contexts'
import { E2eeError } from './errors'
import { deriveMetadataKey, deriveOcrTextKey, deriveThumbnailKey } from './file'
import {
  assertCanonicalX25519PublicKey,
  concatBytes,
  constantTimeEqual,
  deriveKey,
  utf8,
  wipe,
  x25519PublicKey,
} from './primitives'
import {
  SEAL_ONCE_OVERHEAD,
  SEAL_OVERHEAD,
  open,
  openExact,
  seal,
} from './seal'
import { ACCOUNT_STANZA_LENGTH, PASSWORD_STANZA_LENGTH } from './stanza'
import {
  type AccountPrivateKey,
  type AccountPublicKey,
  type FileKey,
  type FolderMetadataKey,
  type FolderOwnerKey,
  type FolderPrivateKey,
  type FolderPublicKey,
  type HeaderHash,
  type SealKey,
  type SealNonce,
  type TagKey,
  asAccountPrivateKey,
  asAccountPublicKey,
  asFolderPrivateKey,
  asFolderPublicKey,
  asHeaderHash,
} from './types'

/**
 * Sealed records: `record_version`, file metadata, image text, thumbnails,
 * folder records and tag records (sections 1.5.1, 8.4.2, 9.1, 9.5, 9.6.1 and
 * 12.1). Each `seal...` and `wrap...` function of the library returns the
 * record without the `record_version` byte. The storage layer adds it with
 * `encodeStoredRecord` and removes it with `decodeStoredRecord`.
 */

// --- record_version (section 4.4, rule 12) ---

export const RECORD_VERSION = 0x01

/**
 * `0x01 || record`. The byte is not an input of `seal` or of `public_wrap`,
 * and the sizes of section 2.3 do not include it. Prefer
 * `encodeStoredRecord`, which also checks the length of the record type.
 */
export function encodeRecord(record: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(RECORD_VERSION), record)
}

/**
 * Removes the `record_version` byte. A version that this client does not
 * know stops with `unknown_version`: the client must tell the user to
 * update, and must not try other rules (section 1.5.2, rule 3).
 */
export function decodeRecord(storedRecord: Uint8Array): Uint8Array {
  if (storedRecord.length === 0) {
    throw new E2eeError('truncated', 'A stored record has no record_version')
  }
  if (storedRecord[0] !== RECORD_VERSION) {
    throw new E2eeError(
      'unknown_version',
      `Unknown record_version ${storedRecord[0]}. Update the client.`
    )
  }
  return storedRecord.slice(1)
}

/**
 * Each stanza and each sealed value that the server stores (section 4.4,
 * rule 12). Every one of them is stored as `0x01 || record`.
 */
export const STORED_RECORD_KINDS = [
  'wrapped_root',
  'sealed_keyring',
  'sealed_metadata',
  'sealed_ocr_text',
  'sealed_thumbnail',
  'sealed_tag_metadata',
  'sealed_folder_metadata',
  'sealed_folder_private_key',
  'account_stanza',
  'password_stanza',
  'folder_file_stanza',
  'folder_link_secret_stanza',
  'parent_folder_stanza',
] as const

export type StoredRecordKind = (typeof STORED_RECORD_KINDS)[number]

const SEALED_KEY_LENGTH = 32 + SEAL_OVERHEAD
const PUBLIC_WRAP_OF_KEY_LENGTH = 32 + 32 + SEAL_ONCE_OVERHEAD

/** True if `length` is a possible length of the record, without the `record_version` byte. */
const RECORD_LENGTH_RULES: Record<
  StoredRecordKind,
  (length: number) => boolean
> = {
  wrapped_root: (length) => length === SEALED_KEY_LENGTH,
  // One or more 32-byte keys. A sealed empty list is not valid (rule 11).
  sealed_keyring: (length) =>
    length >= SEAL_OVERHEAD + 32 && (length - SEAL_OVERHEAD) % 32 === 0,
  sealed_metadata: (length) => length >= SEAL_OVERHEAD,
  sealed_ocr_text: (length) => length >= SEAL_OVERHEAD,
  sealed_thumbnail: (length) => length >= SEAL_OVERHEAD,
  sealed_tag_metadata: (length) => length >= SEAL_OVERHEAD,
  sealed_folder_metadata: (length) => length >= SEAL_OVERHEAD,
  sealed_folder_private_key: (length) => length === SEALED_KEY_LENGTH,
  account_stanza: (length) => length === ACCOUNT_STANZA_LENGTH,
  password_stanza: (length) => length === PASSWORD_STANZA_LENGTH,
  folder_file_stanza: (length) => length === PUBLIC_WRAP_OF_KEY_LENGTH,
  folder_link_secret_stanza: (length) => length === PUBLIC_WRAP_OF_KEY_LENGTH,
  parent_folder_stanza: (length) => length === PUBLIC_WRAP_OF_KEY_LENGTH,
}

function assertRecordLength(kind: StoredRecordKind, record: Uint8Array): void {
  if (!Object.hasOwn(RECORD_LENGTH_RULES, kind)) {
    throw new E2eeError('invalid_argument', 'Not a stored record type')
  }
  if (!RECORD_LENGTH_RULES[kind](record.length)) {
    throw new E2eeError(
      'bad_length',
      `${record.length} bytes is not a possible length of ${kind}`
    )
  }
}

/**
 * The stored form of one record: `0x01 || record`. `kind` names the record
 * type, and a record that cannot have the length of that type fails with
 * `bad_length` before it reaches the server.
 */
export function encodeStoredRecord(
  kind: StoredRecordKind,
  record: Uint8Array
): Uint8Array {
  assertRecordLength(kind, record)
  return encodeRecord(record)
}

/**
 * The reverse of `encodeStoredRecord`: checks and removes `record_version`,
 * then checks the length of the record type. The result is the input of the
 * `open...` or `unwrap...` function of that type.
 */
export function decodeStoredRecord(
  kind: StoredRecordKind,
  storedRecord: Uint8Array
): Uint8Array {
  const record = decodeRecord(storedRecord)
  assertRecordLength(kind, record)
  return record
}

// --- JSON records (section 4.4, rule 9) ---

export type JsonObject = { [key: string]: unknown }

/** UTF-8 JSON. The form is not canonical, because a reader never compares the bytes. */
export function encodeJsonObject(value: object): Uint8Array {
  if (value === null || Array.isArray(value)) {
    throw new E2eeError('invalid_argument', 'A JSON record must be an object')
  }
  return utf8(JSON.stringify(value))
}

/**
 * Accepts each valid JSON object, and nothing else. Does not check which
 * fields it has. In the result, a field that is absent and a field with the
 * value `null` both mean "no value": read fields with `jsonValue` or with a
 * typed reader such as `readTagMetadata`, which treat the two the same.
 */
export function decodeJsonObject(bytes: Uint8Array): JsonObject {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new E2eeError('invalid_encoding', 'The record is not UTF-8 JSON')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new E2eeError('invalid_encoding', 'The record is not a JSON object')
  }
  return value as JsonObject
}

/** The value of a field, where absent and `null` both give `undefined` ("no value"). */
export function jsonValue(record: JsonObject, field: string): unknown {
  const value = Object.hasOwn(record, field) ? record[field] : undefined
  return value === null ? undefined : value
}

function withKey<Key extends SealKey, Result>(
  key: Key,
  run: (key: Key) => Result
): Result {
  try {
    return run(key)
  } finally {
    wipe(key)
  }
}

// --- File metadata (section 9.1) ---

export interface FileMetadata {
  /** The file name */
  readonly name: string
  /** The full MIME type */
  readonly type: string
}

interface FileRecordInput {
  readonly fileKey: FileKey
  readonly nonce: SealNonce
  readonly headerHash: HeaderHash
}

interface FileRecordOpenInput {
  readonly fileKey: FileKey
  readonly headerHash: HeaderHash
}

/** `sealed_metadata = seal(metadata_key, nonce, header_hash, file_metadata)` over given bytes. */
export function sealFileMetadataBytes(
  input: FileRecordInput & { readonly fileMetadata: Uint8Array }
): Uint8Array {
  return withKey(deriveMetadataKey(input.fileKey), (key) =>
    seal(key, input.nonce, asHeaderHash(input.headerHash), input.fileMetadata)
  )
}

export function sealFileMetadata(
  input: FileRecordInput & { readonly metadata: FileMetadata }
): Uint8Array {
  return sealFileMetadataBytes({
    ...input,
    fileMetadata: encodeJsonObject(input.metadata),
  })
}

export function openFileMetadata(
  input: FileRecordOpenInput & { readonly sealedMetadata: Uint8Array }
): JsonObject {
  return decodeJsonObject(
    withKey(deriveMetadataKey(input.fileKey), (key) =>
      open(key, asHeaderHash(input.headerHash), input.sealedMetadata)
    )
  )
}

// --- Text from images (section 9.6.1) ---

/** `sealed_ocr_text = seal(ocr_text_key, nonce, header_hash, ocr_text)`. The text is UTF-8 without normalization. */
export function sealOcrText(
  input: FileRecordInput & { readonly ocrText: string }
): Uint8Array {
  return withKey(deriveOcrTextKey(input.fileKey), (key) =>
    seal(key, input.nonce, asHeaderHash(input.headerHash), utf8(input.ocrText))
  )
}

export function openOcrText(
  input: FileRecordOpenInput & { readonly sealedOcrText: Uint8Array }
): string {
  const bytes = withKey(deriveOcrTextKey(input.fileKey), (key) =>
    open(key, asHeaderHash(input.headerHash), input.sealedOcrText)
  )
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new E2eeError('invalid_encoding', 'The image text is not UTF-8')
  }
}

// --- Thumbnails (section 12.1) ---

/** `sealed_thumbnail = seal(thumbnail_key, nonce, header_hash, thumbnail)`. */
export function sealThumbnail(
  input: FileRecordInput & { readonly thumbnail: Uint8Array }
): Uint8Array {
  return withKey(deriveThumbnailKey(input.fileKey), (key) =>
    seal(key, input.nonce, asHeaderHash(input.headerHash), input.thumbnail)
  )
}

export function openThumbnail(
  input: FileRecordOpenInput & { readonly sealedThumbnail: Uint8Array }
): Uint8Array {
  return withKey(deriveThumbnailKey(input.fileKey), (key) =>
    open(key, asHeaderHash(input.headerHash), input.sealedThumbnail)
  )
}

// --- Folder records (section 8.4.2) ---

export interface FolderMetadata {
  readonly name: string
}

/** `folder_public_key` from `folder_private_key`. The owner never uses the copy of the server. */
export function folderPublicKeyOf(
  folderPrivateKey: FolderPrivateKey
): FolderPublicKey {
  return x25519PublicKey<'folder_public_key'>(
    asFolderPrivateKey(folderPrivateKey)
  )
}

export function deriveFolderMetadataKey(
  folderPrivateKey: FolderPrivateKey
): FolderMetadataKey {
  return deriveKey(
    CONTEXTS.folderMetadata,
    asFolderPrivateKey(folderPrivateKey)
  )
}

export function deriveFolderOwnerKey(
  accountPrivateKey: AccountPrivateKey
): FolderOwnerKey {
  return deriveKey(CONTEXTS.folderOwner, asAccountPrivateKey(accountPrivateKey))
}

/** `sealed_folder_metadata = seal(folder_metadata_key, nonce, folder_public_key, folder_metadata)` over given bytes. */
export function sealFolderMetadataBytes(input: {
  readonly folderPrivateKey: FolderPrivateKey
  readonly nonce: SealNonce
  readonly folderMetadata: Uint8Array
}): Uint8Array {
  const folderPublicKey = folderPublicKeyOf(input.folderPrivateKey)
  return withKey(deriveFolderMetadataKey(input.folderPrivateKey), (key) =>
    seal(key, input.nonce, folderPublicKey, input.folderMetadata)
  )
}

export function sealFolderMetadata(input: {
  readonly folderPrivateKey: FolderPrivateKey
  readonly nonce: SealNonce
  readonly metadata: FolderMetadata
}): Uint8Array {
  return sealFolderMetadataBytes({
    folderPrivateKey: input.folderPrivateKey,
    nonce: input.nonce,
    folderMetadata: encodeJsonObject(input.metadata),
  })
}

/** For the owner and for a visitor of a shared folder: both have `folder_private_key`. */
export function openFolderMetadata(input: {
  readonly folderPrivateKey: FolderPrivateKey
  readonly sealedFolderMetadata: Uint8Array
}): JsonObject {
  const folderPublicKey = folderPublicKeyOf(input.folderPrivateKey)
  return decodeJsonObject(
    withKey(deriveFolderMetadataKey(input.folderPrivateKey), (key) =>
      open(key, folderPublicKey, input.sealedFolderMetadata)
    )
  )
}

/** `sealed_folder_private_key = seal(folder_owner_key, nonce, folder_public_key, folder_private_key)`. */
export function sealFolderPrivateKey(input: {
  readonly accountPrivateKey: AccountPrivateKey
  readonly nonce: SealNonce
  readonly folderPrivateKey: FolderPrivateKey
}): Uint8Array {
  const folderPublicKey = folderPublicKeyOf(input.folderPrivateKey)
  return withKey(deriveFolderOwnerKey(input.accountPrivateKey), (key) =>
    seal(key, input.nonce, folderPublicKey, input.folderPrivateKey)
  )
}

/**
 * Opens the owner's copy of a folder private key. `folderPublicKey` is the
 * value that the server lists. It must be canonical. It is the associated
 * data, so a record of a different folder does not open. The public key is
 * calculated from the opened private key, and a result that is not the
 * listed key fails with `key_mismatch`, as section 8.4.2 requires.
 */
export function openFolderPrivateKey(input: {
  readonly accountPrivateKey: AccountPrivateKey
  readonly folderPublicKey: FolderPublicKey
  readonly sealedFolderPrivateKey: Uint8Array
}): {
  readonly folderPrivateKey: FolderPrivateKey
  readonly folderPublicKey: FolderPublicKey
} {
  const listed = asFolderPublicKey(input.folderPublicKey)
  assertCanonicalX25519PublicKey(listed, 'folder_public_key')
  const folderPrivateKey = withKey(
    deriveFolderOwnerKey(input.accountPrivateKey),
    (key) =>
      openExact(
        key,
        listed,
        input.sealedFolderPrivateKey,
        32,
        'sealed_folder_private_key'
      )
  ) as FolderPrivateKey
  const folderPublicKey = folderPublicKeyOf(folderPrivateKey)
  if (!constantTimeEqual(folderPublicKey, listed)) {
    wipe(folderPrivateKey)
    throw new E2eeError(
      'key_mismatch',
      'The folder private key does not give the folder public key'
    )
  }
  return { folderPrivateKey, folderPublicKey }
}

// --- Tag records (section 9.5) ---

/** What a writer gives. For "no value", leave the field out or give `null`: both mean the same. */
export interface TagMetadata {
  readonly name: string
  /** `filename`, `ocr`, or no value */
  readonly rule_source?: 'filename' | 'ocr' | null
  /** The text that the rule searches for, or no value */
  readonly rule_text?: string | null
}

/** `tag_metadata` after `readTagMetadata`: "no value" is always `null`. */
export interface NormalizedTagMetadata {
  readonly name: string
  readonly rule_source: 'filename' | 'ocr' | null
  readonly rule_text: string | null
}

/**
 * The typed reader of `tag_metadata` (sections 4.4, rule 9, and 9.5.2). A
 * field that is absent and a field with the value `null` both mean "no
 * value", and both come back as `null`. Unknown fields are ignored. A field
 * with a value of the wrong type, a `rule_source` that this client does not
 * know, or no `name` fails with `invalid_encoding`.
 */
export function readTagMetadata(record: JsonObject): NormalizedTagMetadata {
  const invalid = (field: string) =>
    new E2eeError('invalid_encoding', `tag_metadata has no valid ${field}`)
  const name = jsonValue(record, 'name')
  if (typeof name !== 'string') throw invalid('name')
  const ruleSource = jsonValue(record, 'rule_source')
  if (
    ruleSource !== undefined &&
    ruleSource !== 'filename' &&
    ruleSource !== 'ocr'
  ) {
    throw invalid('rule_source')
  }
  const ruleText = jsonValue(record, 'rule_text')
  if (ruleText !== undefined && typeof ruleText !== 'string') {
    throw invalid('rule_text')
  }
  return {
    name,
    rule_source: ruleSource ?? null,
    rule_text: ruleText ?? null,
  }
}

export function deriveTagKey(accountPrivateKey: AccountPrivateKey): TagKey {
  return deriveKey(CONTEXTS.tagMetadata, asAccountPrivateKey(accountPrivateKey))
}

/** `sealed_tag_metadata = seal(tag_key, nonce, account_public_key, tag_metadata)` over given bytes. */
export function sealTagMetadataBytes(input: {
  readonly accountPrivateKey: AccountPrivateKey
  readonly accountPublicKey: AccountPublicKey
  readonly nonce: SealNonce
  readonly tagMetadata: Uint8Array
}): Uint8Array {
  return withKey(deriveTagKey(input.accountPrivateKey), (key) =>
    seal(
      key,
      input.nonce,
      asAccountPublicKey(input.accountPublicKey),
      input.tagMetadata
    )
  )
}

export function sealTagMetadata(input: {
  readonly accountPrivateKey: AccountPrivateKey
  readonly accountPublicKey: AccountPublicKey
  readonly nonce: SealNonce
  readonly metadata: TagMetadata
}): Uint8Array {
  return sealTagMetadataBytes({
    accountPrivateKey: input.accountPrivateKey,
    accountPublicKey: input.accountPublicKey,
    nonce: input.nonce,
    tagMetadata: encodeJsonObject(input.metadata),
  })
}

export function openTagMetadata(input: {
  readonly accountPrivateKey: AccountPrivateKey
  readonly accountPublicKey: AccountPublicKey
  readonly sealedTagMetadata: Uint8Array
}): JsonObject {
  return decodeJsonObject(
    withKey(deriveTagKey(input.accountPrivateKey), (key) =>
      open(
        key,
        asAccountPublicKey(input.accountPublicKey),
        input.sealedTagMetadata
      )
    )
  )
}
