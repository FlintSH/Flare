import { randomBytes } from 'node:crypto'

import {
  type PassphraseRoot,
  type RootEntropy,
  type SealNonce,
  base64urlEncode,
  deriveAccountKeys,
  encodeStoredRecord,
  passphraseKeysFromRoot,
  wrapRoot,
} from '@/lib/e2ee'

/**
 * What a browser holds for one passphrase and one mnemonic, and the account
 * record that it sends. `passphrase_root` is random here in place of the
 * Argon2id output: the server never sees the input or the output of Argon2id,
 * so the tests of the server do not pay for it.
 */
export function clientKeys() {
  const rootEntropy = new Uint8Array(randomBytes(32)) as RootEntropy
  const accountKeys = deriveAccountKeys(rootEntropy)
  const passphraseKeys = passphraseKeysFromRoot(
    new Uint8Array(randomBytes(32)) as PassphraseRoot
  )
  const passphraseSalt = new Uint8Array(randomBytes(32))
  const wrappedRoot = encodeStoredRecord(
    'wrapped_root',
    wrapRoot({
      wrapKey: passphraseKeys.wrapKey,
      nonce: new Uint8Array(randomBytes(24)) as SealNonce,
      accountPublicKey: accountKeys.accountPublicKey,
      rootEntropy,
    })
  )
  return {
    accountKeys,
    passphraseKeys,
    passphraseSalt,
    wrappedRoot,
    /** The account record as a request carries it. */
    record: {
      accountPublicKey: base64urlEncode(accountKeys.accountPublicKey),
      passphraseSalt: base64urlEncode(passphraseSalt),
      protocolVersion: 1,
      authPublicKey: base64urlEncode(passphraseKeys.authPublicKey),
      wrappedRoot: base64urlEncode(wrappedRoot),
    },
    /** The account record as the User row stores it. */
    columns: {
      accountPublicKey: Uint8Array.from(accountKeys.accountPublicKey),
      passphraseSalt: Uint8Array.from(passphraseSalt),
      authPublicKey: Uint8Array.from(passphraseKeys.authPublicKey),
      wrappedRoot: Uint8Array.from(wrappedRoot),
      e2eeProtocolVersion: 1,
    },
  }
}

export type ClientKeys = ReturnType<typeof clientKeys>
