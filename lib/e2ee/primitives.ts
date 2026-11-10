import { xchacha20 } from '@noble/ciphers/chacha.js'
import { ed25519, x25519 as nobleX25519 } from '@noble/curves/ed25519.js'
import { blake3 } from '@noble/hashes/blake3.js'
import { sha512 } from '@noble/hashes/sha2.js'

import { E2eeError } from './errors'
import type {
  Bytes,
  Ed25519PrivateKey,
  Ed25519PublicKey,
  ExchangePrivateKey,
  ExchangePublicKey,
  SharedSecret,
  Signature,
  X25519PrivateKey,
  X25519PublicKey,
} from './types'

/**
 * The primitives of section 4, with the encodings of section 4.4.
 *
 * Nothing here draws randomness. Nothing here uses `Buffer`, Node.js modules
 * or the DOM, so the module runs in a browser, a worker and on the server.
 */

const textEncoder = new TextEncoder()

// --- Byte helpers ---

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let length = 0
  for (const part of parts) length += part.length
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** `LE64(n)`: the integer as 8 bytes, little-endian. */
export function le64(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new E2eeError(
      'invalid_argument',
      'LE64 needs a non-negative safe integer'
    )
  }
  const out = new Uint8Array(8)
  let rest = value
  for (let index = 0; index < 8; index++) {
    out[index] = rest % 256
    rest = Math.floor(rest / 256)
  }
  return out
}

export function utf8(text: string): Uint8Array {
  return textEncoder.encode(text)
}

/** Encodes a context string. Contexts are ASCII without a terminator (section 2.2). */
export function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code > 0x7f) {
      throw new E2eeError('invalid_argument', 'A context string must be ASCII')
    }
    out[index] = code
  }
  return out
}

/**
 * Compares two byte strings without an early exit, so the time does not
 * depend on where they differ. The lengths are public.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index++) {
    difference |= a[index] ^ b[index]
  }
  return difference === 0
}

export function isAllZero(bytes: Uint8Array): boolean {
  let accumulator = 0
  for (let index = 0; index < bytes.length; index++) {
    accumulator |= bytes[index]
  }
  return accumulator === 0
}

/**
 * Overwrites buffers with zeros. JavaScript gives no guarantee that no copy
 * remains, but this removes the copies that the library itself made.
 */
export function wipe(...buffers: Uint8Array[]): void {
  for (const buffer of buffers) buffer.fill(0)
}

function requireLength(name: string, bytes: Uint8Array, length: number): void {
  if (!(bytes instanceof Uint8Array)) {
    throw new E2eeError('invalid_argument', `${name} must be a Uint8Array`)
  }
  if (bytes.length !== length) {
    throw new E2eeError(
      'bad_length',
      `${name} must have ${length} bytes, got ${bytes.length}`
    )
  }
}

// --- Text forms (section 4.4, rule 14) ---

const HEX_DIGITS = '0123456789abcdef'

/** Lower case hexadecimal, as in the test vectors. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let index = 0; index < bytes.length; index++) {
    out += HEX_DIGITS[bytes[index] >> 4] + HEX_DIGITS[bytes[index] & 15]
  }
  return out
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) {
    throw new E2eeError(
      'invalid_encoding',
      'Not a lower case hexadecimal string'
    )
  }
  const out = new Uint8Array(hex.length / 2)
  for (let index = 0; index < out.length; index++) {
    out[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return out
}

const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** `base64url(a)` without padding. */
export function base64urlEncode(bytes: Uint8Array): string {
  let out = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const b0 = bytes[index]
    const b1 = index + 1 < bytes.length ? bytes[index + 1] : 0
    const b2 = index + 2 < bytes.length ? bytes[index + 2] : 0
    out += BASE64URL_ALPHABET[b0 >> 2]
    out += BASE64URL_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)]
    if (index + 1 < bytes.length) {
      out += BASE64URL_ALPHABET[((b1 & 15) << 2) | (b2 >> 6)]
    }
    if (index + 2 < bytes.length) out += BASE64URL_ALPHABET[b2 & 63]
  }
  return out
}

/**
 * Strict decoder: no padding, no characters outside the alphabet, and no
 * unused bits set. Each byte string thus has exactly one text form.
 */
export function base64urlDecode(text: string): Uint8Array {
  const invalid = () =>
    new E2eeError('invalid_encoding', 'Not a base64url string without padding')
  if (text.length % 4 === 1) throw invalid()
  const out = new Uint8Array(Math.floor((text.length * 3) / 4))
  let buffer = 0
  let bits = 0
  let position = 0
  for (let index = 0; index < text.length; index++) {
    const value = BASE64URL_ALPHABET.indexOf(text[index])
    if (value < 0) throw invalid()
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[position++] = (buffer >> bits) & 0xff
      buffer &= (1 << bits) - 1
    }
  }
  if (buffer !== 0) throw invalid()
  return out
}

// --- BLAKE3 (section 4) ---

export const HASH_LENGTH = 32

export function blake3Hash(message: Uint8Array): Uint8Array {
  return blake3(message)
}

/** `blake3_keyed_hash(key, message)` over the concatenation of `parts`. */
export function blake3KeyedHash(
  key: Uint8Array,
  ...parts: Uint8Array[]
): Uint8Array {
  requireLength('blake3 key', key, 32)
  const hasher = blake3.create({ key })
  for (const part of parts) hasher.update(part)
  return hasher.digest()
}

/** `blake3_derive_key(context, key_material)`. The output has 32 bytes. */
export function blake3DeriveKey(
  context: string,
  keyMaterial: Uint8Array
): Uint8Array {
  return blake3(keyMaterial, { context: asciiBytes(context) })
}

/** `blake3_derive_key` with a branded result, for the key hierarchy. */
export function deriveKey<Kind extends string>(
  context: string,
  keyMaterial: Uint8Array
): Bytes<Kind> {
  return blake3DeriveKey(context, keyMaterial) as Bytes<Kind>
}

// --- XChaCha20 (section 4.4, rule 4) ---

/** XChaCha20 with a 32-byte key and a 24-byte nonce. The block counter starts at 0. */
export function xchacha20Xor(
  key: Uint8Array,
  nonce: Uint8Array,
  data: Uint8Array
): Uint8Array {
  requireLength('XChaCha20 key', key, 32)
  requireLength('XChaCha20 nonce', nonce, 24)
  return xchacha20(key, nonce, data, undefined, 0)
}

// --- X25519 (RFC 7748 and section 4.4, rules 3a and 3b) ---

/**
 * True if the 32 bytes, read as a little-endian integer without the highest
 * bit of the last byte, are less than the field prime `2^255 - 19`. The
 * prime is `ed ff ... ff 7f`.
 */
function isBelowFieldPrime(bytes: Uint8Array): boolean {
  if ((bytes[31] & 0x7f) !== 0x7f) return true
  for (let index = 30; index >= 1; index--) {
    if (bytes[index] !== 0xff) return true
  }
  return bytes[0] < 0xed
}

/**
 * Section 4.4, rule 3a: the value is less than `2^255 - 19` and the highest
 * bit of the last byte is zero. A public key is public, so this does not
 * have to run in constant time.
 */
export function isCanonicalX25519PublicKey(publicKey: Uint8Array): boolean {
  return (
    publicKey.length === 32 &&
    (publicKey[31] & 0x80) === 0 &&
    isBelowFieldPrime(publicKey)
  )
}

/**
 * Rejects an `ephemeral_public_key`, a `folder_public_key` or a
 * `recipient_public_key` that is not canonical, with
 * `non_canonical_public_key`. RFC 7748 would mask the highest bit and reduce
 * the value instead, which gives one key several encodings.
 */
export function assertCanonicalX25519PublicKey(
  publicKey: Uint8Array,
  name = 'The X25519 public key'
): void {
  requireLength(name, publicKey, 32)
  if (!isCanonicalX25519PublicKey(publicKey)) {
    throw new E2eeError(
      'non_canonical_public_key',
      `${name} is not in its canonical form`
    )
  }
}

/**
 * The public key of an X25519 private key. A private key is 32 random bytes
 * as they are (rule 3b): the X25519 function clamps a copy inside, and no
 * caller stores, seals or sends a clamped form.
 */
export function x25519PublicKey<Kind extends string = 'x25519_public_key'>(
  privateKey: X25519PrivateKey
): Bytes<Kind> {
  requireLength('X25519 private key', privateKey, 32)
  return nobleX25519.getPublicKey(privateKey) as Bytes<Kind>
}

/**
 * `X25519(private_key, public_key)`. Rejects a public key that is not
 * canonical (section 4.4, rule 3a), then each input that gives the all-zero
 * shared secret (sections 8.1 and 8.4.1).
 */
export function x25519SharedSecret(
  privateKey: X25519PrivateKey,
  publicKey: X25519PublicKey
): SharedSecret {
  requireLength('X25519 private key', privateKey, 32)
  assertCanonicalX25519PublicKey(publicKey)
  let shared: Uint8Array
  try {
    // The library rejects the low-order points before the ladder. Those are
    // exactly the public keys that give zeros(32).
    shared = nobleX25519.getSharedSecret(privateKey, publicKey)
  } catch {
    throw new E2eeError(
      'low_order_point',
      'The X25519 shared secret is all zero'
    )
  }
  if (isAllZero(shared)) {
    throw new E2eeError(
      'low_order_point',
      'The X25519 shared secret is all zero'
    )
  }
  return shared as SharedSecret
}

// --- Ed25519 (RFC 8032) ---

export const SIGNATURE_LENGTH = 64

/** The public key of a 32-byte Ed25519 seed (section 4.4, rule 1). */
export function ed25519PublicKey<Kind extends string = 'ed25519_public_key'>(
  privateKey: Ed25519PrivateKey
): Bytes<Kind> {
  requireLength('Ed25519 private key', privateKey, 32)
  return ed25519.getPublicKey(privateKey) as Bytes<Kind>
}

export function ed25519Sign(
  privateKey: Ed25519PrivateKey,
  message: Uint8Array
): Signature {
  requireLength('Ed25519 private key', privateKey, 32)
  return ed25519.sign(message, privateKey) as Signature
}

/**
 * RFC 8032 verification. Returns `false` for a wrong signature and for a
 * signature or public key that does not decode. ZIP-215 leniency is off: the
 * specification names RFC 8032 only.
 */
export function ed25519Verify(
  publicKey: Ed25519PublicKey,
  message: Uint8Array,
  signature: Uint8Array
): boolean {
  if (publicKey.length !== 32 || signature.length !== SIGNATURE_LENGTH) {
    return false
  }
  try {
    return ed25519.verify(signature, message, publicKey, { zip215: false })
  } catch {
    return false
  }
}

// --- ed2curve (sections 4.1 and 4.4, rules 2 and 3) ---

/** SHA-512 of the seed, first 32 bytes, clamped as RFC 7748 specifies. */
export function ed2curvePrivate(
  privateKey: Ed25519PrivateKey
): ExchangePrivateKey {
  requireLength('Ed25519 private key', privateKey, 32)
  const digest = sha512(privateKey)
  const out = digest.slice(0, 32)
  wipe(digest)
  out[0] &= 248
  out[31] &= 127
  out[31] |= 64
  return out as ExchangePrivateKey
}

/**
 * Section 4.4, rule 3. Decodes the Edwards point as RFC 8032, section 5.1.3,
 * specifies and returns `u = (1 + y) / (1 - y)` as 32 bytes little-endian.
 *
 * The decode is strict. It fails for a `y` that is not less than
 * `2^255 - 19`, for a `y` that has no `x`, and for `x = 0` with the sign bit
 * set. It also fails if `y = 1`, where `u` has no value. The result is
 * always a canonical X25519 public key (rule 3a).
 */
export function ed2curvePublic(publicKey: Ed25519PublicKey): ExchangePublicKey {
  requireLength('Ed25519 public key', publicKey, 32)
  // The check of `y` is explicit, so it does not depend on an option of the
  // curve library.
  if (!isBelowFieldPrime(publicKey)) {
    throw new E2eeError(
      'invalid_public_key',
      'The Ed25519 public key has a y that is not less than 2^255 - 19'
    )
  }
  const field = ed25519.Point.Fp
  let y: bigint
  try {
    // `false` turns ZIP-215 leniency off: RFC 8032 rules only.
    y = ed25519.Point.fromBytes(publicKey, false).toAffine().y
  } catch {
    throw new E2eeError(
      'invalid_public_key',
      'The Ed25519 public key does not decode to a point'
    )
  }
  if (field.eql(y, field.ONE)) {
    throw new E2eeError(
      'invalid_public_key',
      'The Ed25519 public key has no X25519 form (y = 1)'
    )
  }
  const u = field.div(field.add(field.ONE, y), field.sub(field.ONE, y))
  return field.toBytes(u) as ExchangePublicKey
}
