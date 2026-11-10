import { z } from 'zod'

import {
  type EncryptedRecords,
  type EncryptedRecordsWire,
  EncryptedUploadError,
  assertCiphertextLength,
  encryptedRecordFields,
  encryptedRecordsSchema,
  parseEncryptedRecords,
} from '@/lib/files/encrypted'

import { requestFields, uploadRequestOptionFields } from './schema'

/**
 * PHASE 4 INTEGRATION (docs/e2ee-spec.md, sections 8.4.3, 9.6, 9.7 and
 * 12.1). An uploading client says which work it did and can send the
 * records of that work. Each field is text and optional, in the form fields
 * of a single-request upload and in the JSON of a chunked start:
 *
 * - `folderStanza`: base64url of `record_version || stanza` (96 bytes), for
 *   a public file in a folder. With a password stanza it is the
 *   `folder_link_secret_stanza`, without one the `folder_file_stanza`.
 * - `folderPublicKey`: base64url of the 32-byte key the stanza is for.
 * - `sealedOcrText`, `sealedThumbnail`: base64url of sealed records.
 * - `ruleTagIds`: tag identifiers, separated by commas.
 * - `rulesApplied`, `isImage`: `true` or `false`.
 * - `thumbnail`: `none`.
 *
 * This branch has no column for any of them. The strict schemas accept the
 * fields so that one upload contract exists, and `takePendingWorkFields`
 * drops them. The branch with the `rulesPending`, `ocrPending` and
 * `thumbnailPending` flags and the folder keys replaces this block: it
 * stores the records, sets the flags for work that is not done, refuses a
 * folder stanza in a private upload, and refuses a `folderPublicKey` that is
 * not the key of the folder.
 */
const flag = z.enum(['true', 'false'])
const text = (maxLength: number) =>
  z
    .string()
    .max(maxLength)
    .regex(/^[A-Za-z0-9_-]*$/)
export const pendingWorkFields = {
  folderStanza: text(132).optional(),
  folderPublicKey: text(44).optional(),
  sealedOcrText: text(1_500_000).optional(),
  sealedThumbnail: text(1_500_000).optional(),
  ruleTagIds: z
    .string()
    .max(4096)
    .regex(/^[A-Za-z0-9_,-]*$/)
    .optional(),
  rulesApplied: flag.optional(),
  isImage: flag.optional(),
  thumbnail: z.literal('none').optional(),
}
const pendingWorkSchema = z.strictObject(pendingWorkFields)
const PENDING_WORK_KEYS = new Set(Object.keys(pendingWorkFields))

/**
 * PHASE 4 INTEGRATION: takes the declarations out of the fields of an
 * encrypted upload, checks their form, and returns the other fields. The
 * declarations are not stored on this branch.
 */
export function takePendingWorkFields<Value>(
  fields: Record<string, Value>
): Record<string, Value> {
  const declared: Record<string, Value> = {}
  const rest: Record<string, Value> = {}
  for (const [key, value] of Object.entries(fields))
    (PENDING_WORK_KEYS.has(key) ? declared : rest)[key] = value
  if (!pendingWorkSchema.safeParse(declared).success)
    throw new EncryptedUploadError(
      'A declaration of the upload (folder stanza, text, thumbnail or tag rules) is not valid.'
    )
  return rest
}

const RECORD_KEYS = new Set(Object.keys(encryptedRecordFields))
/** The options an encrypted upload can set. A server password is not one. */
const OPTION_KEYS = new Set(
  Object.keys(uploadRequestOptionFields).filter((key) => key !== 'password')
)

/**
 * Splits the form fields of an encrypted upload into its records and its
 * options. Every other field is refused: a field such as `name` could only
 * be a secret that the client must not send.
 */
export function splitEncryptedFields(fields: Record<string, string>): {
  records: EncryptedRecords
  options: Record<string, string>
} {
  const records: Record<string, string> = {}
  const options: Record<string, string> = {}
  for (const [key, value] of Object.entries(takePendingWorkFields(fields))) {
    if (RECORD_KEYS.has(key)) records[key] = value
    else if (OPTION_KEYS.has(key)) options[key] = value
    else if (key === 'copyFormat') continue
    else
      throw new EncryptedUploadError(
        key === 'password'
          ? 'An encrypted file takes a password stanza, not a server password.'
          : `An encrypted upload cannot carry the field "${key}".`
      )
  }
  const parsed = encryptedRecordsSchema.safeParse(records)
  if (!parsed.success)
    throw new EncryptedUploadError(
      'An encrypted upload needs its header, sealed metadata, account stanza and account public key.'
    )
  return { records: parseEncryptedRecords(parsed.data), options }
}

const { password: _serverPassword, ...encryptedOptionFields } =
  uploadRequestOptionFields

/**
 * The start of an encrypted chunked upload. It is strict: `filename`,
 * `mimeType` and `password` are refused, because the server must not get
 * the name or the type and does not check a password for an encrypted file
 * (docs/e2ee-spec.md, sections 8.2 and 9). `size` is the ciphertext size.
 */
const encryptedInitSchema = requestFields({
  ...encryptedOptionFields,
  ...encryptedRecordFields,
  encrypted: z.literal(true),
  size: z.number().int().positive(),
})

/** Whether the start of a chunked upload says anything about encryption. */
export function isEncryptedInit(body: unknown) {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { encrypted?: unknown }).encrypted !== undefined
  )
}

/**
 * Reads the start of an encrypted chunked upload. A record that can never
 * be stored, or a size that no encrypted file has, fails here and not after
 * the bytes were sent.
 */
export function parseEncryptedInit(body: unknown) {
  const parsed = encryptedInitSchema.safeParse(
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? takePendingWorkFields(body as Record<string, unknown>)
      : body
  )
  if (!parsed.success)
    throw new EncryptedUploadError(
      'An encrypted upload takes its size, header, sealed metadata, account stanza and account public key, and no file name, file type or server password.'
    )
  const {
    encrypted: _encrypted,
    size,
    header,
    sealedMetadata,
    accountStanza,
    stanzaAccountPublicKey,
    passwordStanza,
    ...bodyOptions
  } = parsed.data
  const encrypted: EncryptedRecordsWire = {
    header,
    sealedMetadata,
    accountStanza,
    stanzaAccountPublicKey,
    passwordStanza: passwordStanza ?? null,
  }
  parseEncryptedRecords(encrypted)
  assertCiphertextLength(size)
  return { size, encrypted, bodyOptions }
}
