import { isAllZero } from '../primitives'

/**
 * X25519 with the function of the browser (docs/e2ee-spec.md, section
 * 9.8.3). A library opens many account stanzas, and the native function is
 * much faster than JavaScript. Every result is checked against the library
 * by a test, and a caller falls back to the library where a browser has no
 * X25519 in WebCrypto.
 */

/** The PKCS#8 wrapper of a raw X25519 private key (RFC 8410). */
const PKCS8_PREFIX = Uint8Array.of(
  0x30,
  0x2e,
  0x02,
  0x01,
  0x00,
  0x30,
  0x05,
  0x06,
  0x03,
  0x2b,
  0x65,
  0x6e,
  0x04,
  0x22,
  0x04,
  0x20
)

export interface NativeX25519 {
  /** `X25519(private_key, public_key)`, or null where the browser refuses the pair. */
  sharedSecret(publicKey: Uint8Array): Promise<Uint8Array | null>
}

/**
 * Imports an X25519 private key for `deriveBits`. The key is not
 * extractable. Returns null where WebCrypto has no X25519.
 */
export async function importNativeX25519(
  exchangePrivateKey: Uint8Array,
  subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle
): Promise<NativeX25519 | null> {
  if (!subtle || exchangePrivateKey.length !== 32) return null
  const pkcs8 = new Uint8Array(PKCS8_PREFIX.length + 32)
  pkcs8.set(PKCS8_PREFIX)
  pkcs8.set(exchangePrivateKey, PKCS8_PREFIX.length)
  let privateKey: CryptoKey
  try {
    privateKey = await subtle.importKey(
      'pkcs8',
      pkcs8,
      { name: 'X25519' },
      false,
      ['deriveBits']
    )
  } catch {
    return null
  } finally {
    pkcs8.fill(0)
  }
  return {
    async sharedSecret(publicKey) {
      try {
        const peer = await subtle.importKey(
          'raw',
          Uint8Array.from(publicKey),
          { name: 'X25519' },
          false,
          []
        )
        const bits = new Uint8Array(
          await subtle.deriveBits(
            { name: 'X25519', public: peer },
            privateKey,
            256
          )
        )
        // WebCrypto fails for a small-order point. Checked again here, so
        // the rule of section 8.1 does not depend on the browser.
        return isAllZero(bits) ? null : bits
      } catch {
        return null
      }
    },
  }
}
