import { CONTEXTS } from './contexts'
import { E2eeError } from './errors'
import {
  HASH_LENGTH,
  blake3DeriveKey,
  blake3KeyedHash,
  concatBytes,
  constantTimeEqual,
  le64,
  wipe,
  xchacha20Xor,
} from './primitives'
import type { SealKey, SealNonce } from './types'

/** Sealed box construction of section 4.2: XChaCha20, then a keyed BLAKE3 tag. */

export const SEAL_NONCE_LENGTH = 24
export const SEAL_TAG_LENGTH = HASH_LENGTH
/** Bytes that `seal` adds to the message: the nonce and the tag. */
export const SEAL_OVERHEAD = SEAL_NONCE_LENGTH + SEAL_TAG_LENGTH

function sealTag(
  macKey: Uint8Array,
  associatedData: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array
): Uint8Array {
  return blake3KeyedHash(
    macKey,
    le64(associatedData.length),
    associatedData,
    nonce,
    ciphertext
  )
}

/** `seal(key, nonce, associated_data, message)`. The output is `nonce || ciphertext || tag`. */
export function seal(
  key: SealKey,
  nonce: SealNonce,
  associatedData: Uint8Array,
  message: Uint8Array
): Uint8Array {
  if (key.length !== 32) {
    throw new E2eeError('bad_length', 'A seal key must have 32 bytes')
  }
  if (nonce.length !== SEAL_NONCE_LENGTH) {
    throw new E2eeError('bad_length', 'A seal nonce must have 24 bytes')
  }
  const cipherKey = blake3DeriveKey(CONTEXTS.sealCipher, key)
  const macKey = blake3DeriveKey(CONTEXTS.sealMac, key)
  const ciphertext = xchacha20Xor(cipherKey, nonce, message)
  const tag = sealTag(macKey, associatedData, nonce, ciphertext)
  wipe(cipherKey, macKey)
  return concatBytes(nonce, ciphertext, tag)
}

/**
 * `open(key, associated_data, sealed_box)`. Verifies the tag in constant
 * time before it decrypts. Throws `tag_mismatch` for a wrong key, wrong
 * associated data or any changed byte.
 */
export function open(
  key: SealKey,
  associatedData: Uint8Array,
  sealedBox: Uint8Array
): Uint8Array {
  if (key.length !== 32) {
    throw new E2eeError('bad_length', 'A seal key must have 32 bytes')
  }
  if (sealedBox.length < SEAL_OVERHEAD) {
    throw new E2eeError(
      'truncated',
      `A sealed box has at least ${SEAL_OVERHEAD} bytes, got ${sealedBox.length}`
    )
  }
  const nonce = sealedBox.subarray(0, SEAL_NONCE_LENGTH)
  const ciphertext = sealedBox.subarray(
    SEAL_NONCE_LENGTH,
    sealedBox.length - SEAL_TAG_LENGTH
  )
  const tag = sealedBox.subarray(sealedBox.length - SEAL_TAG_LENGTH)
  const cipherKey = blake3DeriveKey(CONTEXTS.sealCipher, key)
  const macKey = blake3DeriveKey(CONTEXTS.sealMac, key)
  const expectedTag = sealTag(macKey, associatedData, nonce, ciphertext)
  wipe(macKey)
  if (!constantTimeEqual(expectedTag, tag)) {
    wipe(cipherKey)
    throw new E2eeError('tag_mismatch', 'The sealed box did not authenticate')
  }
  const message = xchacha20Xor(cipherKey, nonce, ciphertext)
  wipe(cipherKey)
  return message
}

/** `open` for a message that must have one exact length, for example a key. */
export function openExact(
  key: SealKey,
  associatedData: Uint8Array,
  sealedBox: Uint8Array,
  messageLength: number,
  name: string
): Uint8Array {
  if (sealedBox.length !== messageLength + SEAL_OVERHEAD) {
    throw new E2eeError(
      'bad_length',
      `${name} must have ${messageLength + SEAL_OVERHEAD} bytes, got ${sealedBox.length}`
    )
  }
  return open(key, associatedData, sealedBox)
}
