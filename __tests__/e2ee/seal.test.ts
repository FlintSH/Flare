import { describe, expect, it } from 'vitest'

import { CONTEXTS } from '@/lib/e2ee/contexts'
import {
  blake3DeriveKey,
  blake3KeyedHash,
  concatBytes,
  le64,
  utf8,
  xchacha20Xor,
} from '@/lib/e2ee/primitives'
import {
  SEAL_ONCE_OVERHEAD,
  SEAL_OVERHEAD,
  open,
  openExact,
  openOnce,
  seal,
  sealOnce,
} from '@/lib/e2ee/seal'
import { asGenericSealKey, asSealNonce } from '@/lib/e2ee/types'

import { expectReason, flipBit, pattern } from './test-support'

const key = asGenericSealKey(pattern(32, 1))
const nonce = asSealNonce(pattern(24, 2))
const associatedData = utf8('associated data')
const message = utf8('a short message, for example a key')

describe('seal and open', () => {
  it.each([0, 1, 32, 63, 64, 65, 5000])(
    'round-trips a message of %i bytes',
    (length) => {
      const plaintext = pattern(length, 5)
      const sealedBox = seal(key, nonce, associatedData, plaintext)
      expect(sealedBox).toHaveLength(length + SEAL_OVERHEAD)
      expect(open(key, associatedData, sealedBox)).toEqual(plaintext)
    }
  )

  it('is nonce || ciphertext || tag, built as section 4.2 says', () => {
    const sealedBox = seal(key, nonce, associatedData, message)
    const cipherKey = blake3DeriveKey(CONTEXTS.sealCipher, key)
    const macKey = blake3DeriveKey(CONTEXTS.sealMac, key)
    const ciphertext = xchacha20Xor(cipherKey, nonce, message)
    const tag = blake3KeyedHash(
      macKey,
      concatBytes(
        le64(associatedData.length),
        associatedData,
        nonce,
        ciphertext
      )
    )
    expect(sealedBox).toEqual(concatBytes(nonce, ciphertext, tag))
  })

  it('is deterministic and does not change its inputs', () => {
    const keyCopy = key.slice()
    const messageCopy = message.slice()
    expect(seal(key, nonce, associatedData, message)).toEqual(
      seal(key, nonce, associatedData, message)
    )
    expect(key).toEqual(keyCopy)
    expect(message).toEqual(messageCopy)
  })

  it('rejects a flipped bit at every position of the sealed box', () => {
    const sealedBox = seal(key, nonce, associatedData, message)
    for (let index = 0; index < sealedBox.length; index++) {
      expectReason(
        () => open(key, associatedData, flipBit(sealedBox, index)),
        'tag_mismatch'
      )
    }
  })

  it('rejects changed associated data', () => {
    const sealedBox = seal(key, nonce, associatedData, message)
    expectReason(
      () => open(key, flipBit(associatedData, 0), sealedBox),
      'tag_mismatch'
    )
    expectReason(() => open(key, new Uint8Array(0), sealedBox), 'tag_mismatch')
    expectReason(
      () => open(key, concatBytes(associatedData, Uint8Array.of(0)), sealedBox),
      'tag_mismatch'
    )
  })

  it('binds the boundary between associated data and nonce', () => {
    // Moving one byte from the associated data to the front of the nonce
    // keeps the concatenation equal. The length prefix keeps the tags apart.
    const longData = pattern(10, 7)
    const sealedBox = seal(key, nonce, longData, message)
    expectReason(
      () => open(key, longData.subarray(0, 9), sealedBox),
      'tag_mismatch'
    )
  })

  it('rejects a wrong key', () => {
    const sealedBox = seal(key, nonce, associatedData, message)
    expectReason(
      () => open(asGenericSealKey(flipBit(key, 31)), associatedData, sealedBox),
      'tag_mismatch'
    )
  })

  it('rejects a truncated or extended sealed box', () => {
    const sealedBox = seal(key, nonce, associatedData, message)
    expectReason(
      () => open(key, associatedData, sealedBox.subarray(0, 55)),
      'truncated'
    )
    expectReason(
      () => open(key, associatedData, new Uint8Array(0)),
      'truncated'
    )
    expectReason(
      () =>
        open(key, associatedData, sealedBox.subarray(0, sealedBox.length - 1)),
      'tag_mismatch'
    )
    expectReason(
      () => open(key, associatedData, concatBytes(sealedBox, Uint8Array.of(0))),
      'tag_mismatch'
    )
  })

  it('gives different ciphertext for a different nonce', () => {
    const other = asSealNonce(flipBit(nonce, 23))
    const first = seal(key, nonce, associatedData, message)
    const second = seal(key, other, associatedData, message)
    expect(first.subarray(24, 24 + message.length)).not.toEqual(
      second.subarray(24, 24 + message.length)
    )
  })

  it('checks the lengths of the key and the nonce', () => {
    expectReason(() => asGenericSealKey(pattern(31)), 'bad_length')
    expectReason(() => asSealNonce(pattern(12)), 'bad_length')
    expectReason(
      () =>
        seal(
          pattern(16) as unknown as typeof key,
          nonce,
          associatedData,
          message
        ),
      'bad_length'
    )
    expectReason(
      () =>
        seal(
          key,
          pattern(12) as unknown as typeof nonce,
          associatedData,
          message
        ),
      'bad_length'
    )
  })

  it('openExact rejects a box of the wrong size before the tag check', () => {
    const sealedBox = seal(key, nonce, associatedData, pattern(32))
    expect(openExact(key, associatedData, sealedBox, 32, 'box')).toEqual(
      pattern(32)
    )
    expectReason(
      () => openExact(key, associatedData, sealedBox, 31, 'box'),
      'bad_length'
    )
  })
})

describe('sealed box length', () => {
  it('rejects each box of less than 56 bytes', () => {
    expect(SEAL_OVERHEAD).toBe(56)
    const empty = seal(key, nonce, associatedData, new Uint8Array(0))
    expect(empty).toHaveLength(56)
    expect(open(key, associatedData, empty)).toEqual(new Uint8Array(0))
    for (const length of [0, 1, 24, 32, 55]) {
      expectReason(
        () => open(key, associatedData, empty.subarray(0, length)),
        'truncated'
      )
      expectReason(
        () => open(key, associatedData, new Uint8Array(length)),
        'truncated'
      )
    }
  })
})

describe('seal_once and open_once (section 4.2.1)', () => {
  const oneTimeNonce = asSealNonce(
    blake3DeriveKey('flare e2ee v1 one-time nonce', key).subarray(0, 24)
  )

  it('has the context string in the table', () => {
    expect(CONTEXTS.oneTimeNonce).toBe('flare e2ee v1 one-time nonce')
  })

  it.each([0, 1, 32, 63, 64, 65, 5000])(
    'round-trips a message of %i bytes',
    (length) => {
      const plaintext = pattern(length, 5)
      const box = sealOnce(key, associatedData, plaintext)
      expect(box).toHaveLength(length + SEAL_ONCE_OVERHEAD)
      expect(openOnce(key, associatedData, box)).toEqual(plaintext)
    }
  )

  it('is seal with the derived nonce, without its first 24 bytes', () => {
    expect(SEAL_ONCE_OVERHEAD).toBe(32)
    const box = sealOnce(key, associatedData, message)
    const sealedBox = seal(key, oneTimeNonce, associatedData, message)
    expect(box).toEqual(sealedBox.subarray(24))
    expect(box).toHaveLength(message.length + 32)
    // The stored form holds no nonce, and open with the nonce put back agrees.
    expect(open(key, associatedData, concatBytes(oneTimeNonce, box))).toEqual(
      message
    )
    // The tag covers the nonce, as in section 4.2.
    const macKey = blake3DeriveKey(CONTEXTS.sealMac, key)
    const ciphertext = box.subarray(0, message.length)
    expect(box.subarray(message.length)).toEqual(
      blake3KeyedHash(
        macKey,
        concatBytes(
          le64(associatedData.length),
          associatedData,
          oneTimeNonce,
          ciphertext
        )
      )
    )
  })

  it('is deterministic, and the nonce is not zero', () => {
    expect(sealOnce(key, associatedData, message)).toEqual(
      sealOnce(key, associatedData, message)
    )
    expect(oneTimeNonce).not.toEqual(new Uint8Array(24))
    const zeroNonceBox = seal(
      key,
      asSealNonce(new Uint8Array(24)),
      associatedData,
      message
    )
    expect(sealOnce(key, associatedData, message)).not.toEqual(
      zeroNonceBox.subarray(24)
    )
    expectReason(
      () => openOnce(key, associatedData, zeroNonceBox.subarray(24)),
      'tag_mismatch'
    )
  })

  it('gives a different nonce and box for a different key', () => {
    const otherKey = asGenericSealKey(flipBit(key, 31))
    const first = sealOnce(key, associatedData, message)
    const second = sealOnce(otherKey, associatedData, message)
    expect(first.subarray(0, message.length)).not.toEqual(
      second.subarray(0, message.length)
    )
    expectReason(
      () => openOnce(otherKey, associatedData, first),
      'tag_mismatch'
    )
  })

  it('rejects each changed byte and wrong associated data', () => {
    const box = sealOnce(key, associatedData, message)
    for (let index = 0; index < box.length; index++) {
      expectReason(
        () => openOnce(key, associatedData, flipBit(box, index)),
        'tag_mismatch'
      )
    }
    expectReason(() => openOnce(key, utf8('other'), box), 'tag_mismatch')
    expectReason(
      () => openOnce(key, associatedData, box.subarray(0, box.length - 1)),
      'tag_mismatch'
    )
  })

  it('rejects each box of less than 32 bytes', () => {
    const empty = sealOnce(key, associatedData, new Uint8Array(0))
    expect(empty).toHaveLength(32)
    expect(openOnce(key, associatedData, empty)).toEqual(new Uint8Array(0))
    for (const length of [0, 1, 31]) {
      expectReason(
        () => openOnce(key, associatedData, empty.subarray(0, length)),
        'truncated'
      )
    }
  })

  it('checks the length of the key', () => {
    const short = pattern(16) as unknown as typeof key
    expectReason(() => sealOnce(short, associatedData, message), 'bad_length')
    expectReason(
      () => openOnce(short, associatedData, new Uint8Array(40)),
      'bad_length'
    )
  })
})
