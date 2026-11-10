import type { AccountRecord } from '../account'
import { PROTOCOL_VERSION } from '../contexts'
import { E2eeError } from '../errors'
import { base64urlDecode, base64urlEncode } from '../primitives'
import { decodeStoredRecord, encodeStoredRecord } from '../records'
import type { AccountPublicKey, Challenge, PassphraseSalt } from '../types'
import { asAccountPublicKey, asChallenge, asPassphraseSalt } from '../types'

/**
 * The account record as the account routes carry it in JSON
 * (docs/site/api/account-keys.md): each binary value in base64url without
 * padding, and each sealed record in its stored form with the
 * `record_version` byte (docs/e2ee-spec.md, section 4.4, rules 12 and 14).
 */
export interface WireAccountRecord {
  accountPublicKey: string
  passphraseSalt: string
  protocolVersion: typeof PROTOCOL_VERSION
  authPublicKey: string
  wrappedRoot: string
}

export function accountRecordToWire(record: AccountRecord): WireAccountRecord {
  return {
    accountPublicKey: base64urlEncode(record.accountPublicKey),
    passphraseSalt: base64urlEncode(record.passphraseSalt),
    protocolVersion: record.protocolVersion,
    authPublicKey: base64urlEncode(record.authPublicKey),
    wrappedRoot: base64urlEncode(
      encodeStoredRecord('wrapped_root', record.wrappedRoot)
    ),
  }
}

/** `sealed_keyring` for a request body: the stored form, or null for an account with no old key. */
export function sealedKeyringToWire(
  sealedKeyring: Uint8Array | null
): string | null {
  return sealedKeyring
    ? base64urlEncode(encodeStoredRecord('sealed_keyring', sealedKeyring))
    : null
}

/** The record inside a `wrappedRoot` that the unlock route returned. */
export function wrappedRootFromWire(text: string): Uint8Array {
  return decodeStoredRecord('wrapped_root', base64urlDecode(text))
}

/** The record inside a `sealedKeyring` of a response, or null when the account has none. */
export function sealedKeyringFromWire(
  text: string | null | undefined
): Uint8Array | null {
  return text
    ? decodeStoredRecord('sealed_keyring', base64urlDecode(text))
    : null
}

export function challengeFromWire(text: string): Challenge {
  return asChallenge(base64urlDecode(text)) as Challenge
}

export function passphraseSaltFromWire(text: string): PassphraseSalt {
  return asPassphraseSalt(base64urlDecode(text)) as PassphraseSalt
}

export function accountPublicKeyFromWire(text: string): AccountPublicKey {
  return asAccountPublicKey(base64urlDecode(text)) as AccountPublicKey
}

/**
 * Section 1.5.2, rule 3: a client that finds a version that it does not know
 * stops. It never tries the rules of a different version.
 */
export function assertKnownProtocolVersion(version: unknown): void {
  if (version !== PROTOCOL_VERSION)
    throw new E2eeError(
      'unknown_version',
      'This account uses a protocol_version that this client does not know'
    )
}
