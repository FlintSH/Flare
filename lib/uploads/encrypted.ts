import { z } from 'zod'

import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import {
  type EncryptedRecords,
  type EncryptedRecordsWire,
  EncryptedUploadError,
  assertCiphertextLength,
  encryptedRecordsSchema,
  encryptedUploadFields,
  parseEncryptedRecords,
} from '@/lib/files/encrypted'

import { requestFields, uploadRequestOptionFields } from './schema'

/**
 * Who can send an encrypted upload in this release: a signed-in browser.
 * Named tokens and the account upload token send plain files, as the
 * screenshot tool configurations that hold them always did
 * (docs/e2ee-spec.md, section 14.4). The program for script clients
 * (section 10.2) lifts this limit.
 */
export function assertEncryptedUploader(user: AuthenticatedUser) {
  if (user.credential !== 'session')
    throw new EncryptedUploadError(
      'Encrypted uploads need a browser session. Uploads with a token are plain files.',
      403
    )
}

const RECORD_KEYS = new Set(Object.keys(encryptedUploadFields))
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
  for (const [key, value] of Object.entries(fields)) {
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
  ...encryptedUploadFields,
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
  const parsed = encryptedInitSchema.safeParse(body)
  if (!parsed.success)
    throw new EncryptedUploadError(
      'An encrypted upload takes its size, header, sealed metadata, account stanza and account public key, and no file name, file type or server password.'
    )
  const { encrypted: _encrypted, size, ...sent } = parsed.data
  const records: Record<string, unknown> = {}
  const bodyOptions: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(sent))
    (RECORD_KEYS.has(key) ? records : bodyOptions)[key] = value
  // The session of the upload keeps "no password stanza" as an explicit null.
  records.passwordStanza ??= null
  const encrypted = records as EncryptedRecordsWire
  parseEncryptedRecords(encrypted)
  assertCiphertextLength(size)
  return { size, encrypted, bodyOptions }
}
