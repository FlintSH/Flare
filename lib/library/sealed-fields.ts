import { z } from 'zod'

import {
  base64urlDecode,
  base64urlEncode,
  isCanonicalX25519PublicKey,
} from '@/lib/e2ee/primitives'
import { type StoredRecordKind, decodeStoredRecord } from '@/lib/e2ee/records'

/**
 * Request fields that carry a sealed record or a public key of the library
 * (docs/e2ee-spec.md, sections 8.4 and 9.5). The server never opens a
 * record. It checks the `record_version` byte and the length rule of the
 * record type, and stores the bytes as they arrived (section 4.4, rule 12).
 * Each binary value is base64url without padding (rule 14).
 */

/** Bytes in the type that a Prisma `Bytes` column takes. */
export type StoredBytes = Uint8Array<ArrayBuffer>

const BASE64URL = /^[A-Za-z0-9_-]+$/

function decoded(text: string): StoredBytes | null {
  try {
    return Uint8Array.from(base64urlDecode(text))
  } catch {
    return null
  }
}

/**
 * A stored record of `kind`: `record_version || record`, at most `maxBytes`
 * bytes without the version byte.
 */
export function storedRecordField(kind: StoredRecordKind, maxBytes: number) {
  return z
    .string()
    .min(1)
    .max(Math.ceil(((maxBytes + 1) * 4) / 3) + 2, `${kind} is too long.`)
    .regex(BASE64URL, `${kind} must be base64url without padding.`)
    .transform((text, context) => {
      const stored = decoded(text)
      if (stored && stored.length <= maxBytes + 1)
        try {
          decodeStoredRecord(kind, stored)
          return stored
        } catch {
          /* Answered below. */
        }
      context.addIssue({
        code: 'custom',
        message: `${kind} is not a valid stored record.`,
      })
      return z.NEVER
    })
}

/** An X25519 public key in its canonical form (section 4.4, rule 3a). */
export function x25519PublicKeyField(name: string) {
  return z
    .string()
    .length(43, `${name} must have 32 bytes.`)
    .regex(BASE64URL, `${name} must be base64url without padding.`)
    .transform((text, context) => {
      const key = decoded(text)
      if (key && key.length === 32 && isCanonicalX25519PublicKey(key))
        return key
      context.addIssue({
        code: 'custom',
        message: `${name} is not a valid public key.`,
      })
      return z.NEVER
    })
}

/** A sealed folder name: a JSON object with a name of at most 80 characters. */
export const SEALED_FOLDER_METADATA_MAX_BYTES = 56 + 1024
/** A sealed tag name and rule: a name of 40 and a rule text of 200 characters. */
export const SEALED_TAG_METADATA_MAX_BYTES = 56 + 2048

export const sealedFolderMetadataField = storedRecordField(
  'sealed_folder_metadata',
  SEALED_FOLDER_METADATA_MAX_BYTES
)
export const sealedFolderPrivateKeyField = storedRecordField(
  'sealed_folder_private_key',
  88
)
export const parentFolderStanzaField = storedRecordField(
  'parent_folder_stanza',
  96
)
/** A `folder_file_stanza` or a `folder_link_secret_stanza`: both have one length. */
export const folderStanzaField = storedRecordField('folder_file_stanza', 96)
export const folderPublicKeyField = x25519PublicKeyField('folder_public_key')
export const sealedTagMetadataField = storedRecordField(
  'sealed_tag_metadata',
  SEALED_TAG_METADATA_MAX_BYTES
)

/** A stored value as a response carries it, or null. */
export function wireBytes(value: Uint8Array | null | undefined): string | null {
  return value ? base64urlEncode(value) : null
}

export function sameStoredBytes(
  a: Uint8Array | null | undefined,
  b: Uint8Array | null | undefined
): boolean {
  if (!a || !b) return false
  return a.length === b.length && a.every((byte, index) => byte === b[index])
}
