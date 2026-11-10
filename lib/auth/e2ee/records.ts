import type { Prisma } from '@prisma/client'
import { z } from 'zod'

import {
  type AccountPublicKey,
  type AuthPublicKey,
  PROTOCOL_VERSION,
  SIGNATURE_LENGTH,
  base64urlDecode,
  base64urlEncode,
  decodeStoredRecord,
  ed2curvePublic,
} from '@/lib/e2ee'

// The account record of docs/e2ee-spec.md, section 5.3, as requests carry it
// and as the User row stores it. The server reads the public keys and the
// salt. `wrapped_root` and `sealed_keyring` are ciphertext to it: it checks
// their length and never opens them.

/** Bytes in the type that a Prisma `Bytes` column takes. */
export type StoredBytes = Uint8Array<ArrayBuffer>

function storable(bytes: Uint8Array): StoredBytes {
  return Uint8Array.from(bytes)
}

/** A value of `length` bytes in the text form of section 4.4, rule 14. */
function bytesField(name: string, length: number) {
  const characters = Math.ceil((length * 4) / 3)
  return z
    .string()
    .length(characters, `${name} must have ${length} bytes.`)
    .transform((text, context) => {
      try {
        const bytes = base64urlDecode(text)
        if (bytes.length === length) return storable(bytes)
      } catch {
        /* Answered below. */
      }
      context.addIssue({
        code: 'custom',
        message: `${name} must be ${length} bytes in base64url without padding.`,
      })
      return z.NEVER
    })
}

/** An Ed25519 public key that decodes to a point (section 4.4, rule 3). */
function publicKeyField(name: string) {
  return bytesField(name, 32).refine((bytes) => {
    try {
      // The check of section 4.1: a key with no X25519 form is rejected.
      ed2curvePublic(bytes as AccountPublicKey)
      return true
    } catch {
      return false
    }
  }, `${name} is not a valid public key.`)
}

/**
 * A sealed record in its stored form, `record_version || record` (section
 * 4.4, rule 12). The client writes the version byte, because the client knows
 * which rules made the record. The server checks the byte and the length rule
 * of the record type, and stores the bytes as they arrived.
 */
function sealedField(
  name: 'wrapped_root' | 'sealed_keyring',
  maxBytes: number
) {
  return z
    .string()
    .min(1)
    .max(Math.ceil(((maxBytes + 1) * 4) / 3), `${name} is too long.`)
    .transform((text, context) => {
      try {
        const stored = base64urlDecode(text)
        decodeStoredRecord(name, stored)
        return storable(stored)
      } catch {
        context.addIssue({
          code: 'custom',
          message: `${name} is not a valid stored record.`,
        })
        return z.NEVER
      }
    })
}

/** Old keys a keyring may hold. Each rotation adds one until the stanza migration removes it. */
const MAX_KEYRING_KEYS = 64
const MAX_KEYRING_BYTES = 56 + MAX_KEYRING_KEYS * 32

export const challengeField = bytesField('challenge', 32)
export const signatureField = bytesField('signature', SIGNATURE_LENGTH)

/**
 * `sealed_keyring` in a request: the record, or null for an account with no
 * old key (section 4.4, rule 11).
 */
export const sealedKeyringField = sealedField(
  'sealed_keyring',
  MAX_KEYRING_BYTES
).nullable()

/**
 * What the client sends in step 7 of section 5.4. Strict: a request that
 * carries any other field, such as a passphrase or a private key, is refused
 * instead of having the field ignored.
 */
export const accountRecordSchema = z.strictObject({
  accountPublicKey: publicKeyField('account_public_key'),
  passphraseSalt: bytesField('passphrase_salt', 32),
  protocolVersion: z.literal(
    PROTOCOL_VERSION,
    'This server accepts protocol_version 1 only.'
  ),
  authPublicKey: publicKeyField('auth_public_key'),
  wrappedRoot: sealedField('wrapped_root', 88),
})

export type AccountRecordInput = z.output<typeof accountRecordSchema>

/** The User columns of a new account record. `sealed_keyring` is the caller's. */
export function accountRecordColumns(record: AccountRecordInput) {
  return {
    accountPublicKey: record.accountPublicKey,
    passphraseSalt: record.passphraseSalt,
    authPublicKey: record.authPublicKey,
    wrappedRoot: record.wrappedRoot,
    e2eeProtocolVersion: record.protocolVersion,
    // An account that has keys has no password hash (section 14.1, step 4).
    password: null,
  } satisfies Prisma.UserUpdateInput
}

/** The key columns of a User row that has keys. */
export interface KeyedAccount {
  accountPublicKey: Uint8Array
  passphraseSalt: Uint8Array
  authPublicKey: Uint8Array
  wrappedRoot: Uint8Array
  sealedKeyring: Uint8Array | null
  e2eeProtocolVersion: number
}

type KeyColumns = {
  [Column in keyof KeyedAccount]: KeyedAccount[Column] | null
}

/** Whether the account completed key setup. The columns are set together. */
export function hasAccountKeys<Account extends Partial<KeyColumns>>(
  account: Account
): account is Account & KeyedAccount {
  return Boolean(account.authPublicKey)
}

export function sameBytes(
  a: Uint8Array | null | undefined,
  b: Uint8Array | null | undefined
) {
  if (!a || !b) return a == null && b == null
  return a.length === b.length && a.every((byte, index) => byte === b[index])
}

export const encodeBytes = base64urlEncode

export const asAuthPublicKey = (bytes: Uint8Array) => bytes as AuthPublicKey
export const asAccountPublicKey = (bytes: Uint8Array) =>
  bytes as AccountPublicKey
