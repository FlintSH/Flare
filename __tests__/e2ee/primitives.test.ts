import { hchacha } from '@noble/ciphers/chacha.js'
import { ed25519 } from '@noble/curves/ed25519.js'
import { argon2id } from '@noble/hashes/argon2.js'
import { createCipheriv } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { nobleArgon2id } from '@/lib/e2ee/argon2-noble'
import {
  CONTEXTS,
  PROTOCOL_VERSION,
  assertSupportedProtocolVersion,
} from '@/lib/e2ee/contexts'
import {
  asciiBytes,
  assertCanonicalX25519PublicKey,
  base64urlDecode,
  base64urlEncode,
  blake3DeriveKey,
  blake3Hash,
  blake3KeyedHash,
  bytesToHex,
  concatBytes,
  constantTimeEqual,
  ed2curvePrivate,
  ed2curvePublic,
  ed25519PublicKey,
  ed25519Sign,
  ed25519Verify,
  hexToBytes,
  isCanonicalX25519PublicKey,
  le64,
  utf8,
  x25519PublicKey,
  x25519SharedSecret,
  xchacha20Xor,
} from '@/lib/e2ee/primitives'
import {
  asAccountPrivateKey,
  asAccountPublicKey,
  asEphemeralPrivateKey,
  asEphemeralPublicKey,
  asFileKey,
} from '@/lib/e2ee/types'

import { expectReason, hex, mod251, pattern } from './test-support'

describe('published known answers', () => {
  // RFC 8032, section 7.1, TEST 1 to TEST 3.
  const rfc8032 = [
    {
      secret:
        '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
      public:
        'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
      message: '',
      signature:
        'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155' +
        '5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
    },
    {
      secret:
        '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb',
      public:
        '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c',
      message: '72',
      signature:
        '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da' +
        '085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00',
    },
    {
      secret:
        'c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7',
      public:
        'fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025',
      message: 'af82',
      signature:
        '6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac' +
        '18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a',
    },
  ]

  it.each(rfc8032)('Ed25519 matches RFC 8032 ($message)', (vector) => {
    const secret = asAccountPrivateKey(hex(vector.secret))
    const publicKey = ed25519PublicKey<'account_public_key'>(secret)
    expect(bytesToHex(publicKey)).toBe(vector.public)
    const signature = ed25519Sign(secret, hex(vector.message))
    expect(bytesToHex(signature)).toBe(vector.signature)
    expect(ed25519Verify(publicKey, hex(vector.message), signature)).toBe(true)
    expect(
      ed25519Verify(publicKey, hex(vector.message + '00'), signature)
    ).toBe(false)
  })

  it('X25519 matches RFC 7748, section 6.1', () => {
    const alice = asEphemeralPrivateKey(
      hex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a')
    )
    const bob = asEphemeralPrivateKey(
      hex('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb')
    )
    const alicePublic = x25519PublicKey<'ephemeral_public_key'>(alice)
    const bobPublic = x25519PublicKey<'ephemeral_public_key'>(bob)
    expect(bytesToHex(alicePublic)).toBe(
      '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a'
    )
    expect(bytesToHex(bobPublic)).toBe(
      'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f'
    )
    const shared =
      '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742'
    expect(bytesToHex(x25519SharedSecret(alice, bobPublic))).toBe(shared)
    expect(bytesToHex(x25519SharedSecret(bob, alicePublic))).toBe(shared)
  })

  // BLAKE3 team, test_vectors/test_vectors.json. The input byte at offset i
  // is i mod 251. Each expected value is the first 32 bytes of the output.
  const blake3Key = utf8('whats the Elvish word for friend')
  const blake3Context = 'BLAKE3 2019-12-27 16:29:52 test vectors context'
  const blake3Vectors = [
    {
      length: 0,
      hash: 'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262',
      keyed: '92b2b75604ed3c761f9d6f62392c8a9227ad0ea3f09573e783f1498a4ed60d26',
      derive:
        '2cc39783c223154fea8dfb7c1b1660f2ac2dcbd1c1de8277b0b0dd39b7e50d7d',
    },
    {
      length: 1,
      hash: '2d3adedff11b61f14c886e35afa036736dcd87a74d27b5c1510225d0f592e213',
      keyed: '6d7878dfff2f485635d39013278ae14f1454b8c0a3a2d34bc1ab38228a80c95b',
      derive:
        'b3e2e340a117a499c6cf2398a19ee0d29cca2bb7404c73063382693bf66cb06c',
    },
    {
      length: 1024,
      hash: '42214739f095a406f3fc83deb889744ac00df831c10daa55189b5d121c855af7',
      keyed: '75c46f6f3d9eb4f55ecaaee480db732e6c2105546f1e675003687c31719c7ba4',
      derive:
        '7356cd7720d5b66b6d0697eb3177d9f8d73a4a5c5e968896eb6a689684302706',
    },
    {
      length: 1025,
      hash: 'd00278ae47eb27b34faecf67b4fe263f82d5412916c1ffd97c8cb7fb814b8444',
      keyed: '357dc55de0c7e382c900fd6e320acc04146be01db6a8ce7210b7189bd664ea69',
      derive:
        'effaa245f065fbf82ac186839a249707c3bddf6d3fdda22d1b95a3c970379bcb',
    },
    {
      length: 102400,
      hash: 'bc3e3d41a1146b069abffad3c0d44860cf664390afce4d9661f7902e7943e085',
      keyed: '1c35d1a5811083fd7119f5d5d1ba027b4d01c0c6c49fb6ff2cf75393ea5db4a7',
      derive:
        '4652cff7a3f385a6103b5c260fc1593e13c778dbe608efb092fe7ee69df6e9c6',
    },
  ]

  it.each(blake3Vectors)(
    'BLAKE3 matches the official vectors (length $length)',
    (vector) => {
      const input = mod251(vector.length)
      expect(bytesToHex(blake3Hash(input))).toBe(vector.hash)
      expect(bytesToHex(blake3KeyedHash(blake3Key, input))).toBe(vector.keyed)
      expect(bytesToHex(blake3DeriveKey(blake3Context, input))).toBe(
        vector.derive
      )
    }
  )

  it('blake3_keyed_hash of parts equals the hash of their concatenation', () => {
    const input = mod251(1025)
    expect(
      blake3KeyedHash(
        blake3Key,
        input.subarray(0, 7),
        new Uint8Array(0),
        input.subarray(7)
      )
    ).toEqual(blake3KeyedHash(blake3Key, input))
  })

  // draft-irtf-cfrg-xchacha-03, appendix A.3.2.1 (block counter 0).
  const xchachaKey = hex(
    '808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f'
  )
  const xchachaNonce = hex('404142434445464748494a4b4c4d4e4f5051525354555658')

  it('XChaCha20 matches the draft RFC with block counter 0', () => {
    const plaintext = utf8(
      'The dhole (pronounced "dole") is also known as the Asiatic wild dog, ' +
        'red dog, and whistling dog. It is about the size of a German ' +
        'shepherd but looks more like a long-legged fox. This highly ' +
        'elusive and skilled jumper is classified with wolves, coyotes, ' +
        'jackals, and foxes in the taxonomic family Canidae.'
    )
    const ciphertext =
      '4559abba4e48c16102e8bb2c05e6947f50a786de162f9b0b7e592a9b53d0d4e9' +
      '8d8d6410d540a1a6375b26d80dace4fab52384c731acbf16a5923c0c48d3575d' +
      '4d0d2c673b666faa731061277701093a6bf7a158a8864292a41c48e3a9b4c0da' +
      'ece0f8d98d0d7e05b37a307bbb66333164ec9e1b24ea0d6c3ffddcec4f68e744' +
      '3056193a03c810e11344ca06d8ed8a2bfb1e8d48cfa6bc0eb4e2464b74814240' +
      '7c9f431aee769960e15ba8b96890466ef2457599852385c661f752ce20f9da0c' +
      '09ab6b19df74e76a95967446f8d0fd415e7bee2a12a114c20eb5292ae7a349ae' +
      '577820d5520a1f3fb62a17ce6a7e68fa7c79111d8860920bc048ef43fe84486c' +
      'cb87c25f0ae045f0cce1e7989a9aa220a28bdd4827e751a24a6d5c62d790a663' +
      '93b93111c1a55dd7421a10184974c7c5'
    expect(plaintext.length).toBe(304)
    expect(bytesToHex(xchacha20Xor(xchachaKey, xchachaNonce, plaintext))).toBe(
      ciphertext
    )
    expect(xchacha20Xor(xchachaKey, xchachaNonce, hex(ciphertext))).toEqual(
      plaintext
    )
  })

  it('XChaCha20 equals HChaCha20 plus the ChaCha20 of a second implementation', () => {
    // Subkey by HChaCha20, then IETF ChaCha20 from OpenSSL with counter 0 and
    // the nonce 00000000 || nonce[16..24].
    const words = (bytes: Uint8Array) =>
      new Uint32Array(bytes.buffer.slice(0), 0, bytes.length / 4)
    const sigma = words(asciiBytes('expand 32-byte k'))
    const subkey = new Uint32Array(8)
    hchacha(sigma, words(xchachaKey), words(xchachaNonce.slice(0, 16)), subkey)
    const subkeyBytes = new Uint8Array(subkey.buffer)
    // OpenSSL takes a 16-byte IV: the 32-bit counter, then the 96-bit nonce.
    const iv = concatBytes(new Uint8Array(8), xchachaNonce.slice(16))
    const cipher = createCipheriv('chacha20', subkeyBytes, iv)
    const data = pattern(1000)
    const expected = new Uint8Array(
      Buffer.concat([cipher.update(data), cipher.final()])
    )
    expect(xchacha20Xor(xchachaKey, xchachaNonce, data)).toEqual(expected)
  })

  it('Argon2id of the library matches RFC 9106, section 5.3', () => {
    const tag = argon2id(
      new Uint8Array(32).fill(1),
      new Uint8Array(16).fill(2),
      {
        m: 32,
        t: 3,
        p: 4,
        dkLen: 32,
        version: 0x13,
        key: new Uint8Array(8).fill(3),
        personalization: new Uint8Array(12).fill(4),
      }
    )
    expect(bytesToHex(tag)).toBe(
      '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659'
    )
  })

  it('the injected Argon2id has no secret and no associated data', async () => {
    const password = utf8('password')
    const salt = pattern(32)
    const viaInterface = await nobleArgon2id({
      password,
      salt,
      memoryKib: 32,
      passes: 3,
      lanes: 4,
      outputLength: 32,
    })
    expect(viaInterface).toEqual(
      argon2id(password, salt, { m: 32, t: 3, p: 4, dkLen: 32 })
    )
  })
})

describe('ed2curve', () => {
  const seed = asAccountPrivateKey(pattern(32, 9))
  const publicKey = ed25519PublicKey<'account_public_key'>(seed)

  it('gives matching X25519 keys for one Ed25519 key pair', () => {
    const exchangePrivate = ed2curvePrivate(seed)
    const exchangePublic = ed2curvePublic(publicKey)
    expect(x25519PublicKey(exchangePrivate)).toEqual(exchangePublic)
    // Clamped as RFC 7748 specifies.
    expect(exchangePrivate[0] & 7).toBe(0)
    expect(exchangePrivate[31] & 0xc0).toBe(0x40)
  })

  it('agrees with the conversion of the curve library', () => {
    expect(ed2curvePublic(publicKey)).toEqual(
      ed25519.utils.toMontgomery(publicKey)
    )
    expect(ed2curvePrivate(seed)).toEqual(
      ed25519.utils.toMontgomerySecret(seed)
    )
  })

  it('agrees with RFC 7748 for the base point: y = 4/5 gives u = 9', () => {
    const basePoint = asAccountPublicKey(ed25519.Point.BASE.toBytes())
    const nine = new Uint8Array(32)
    nine[0] = 9
    expect(ed2curvePublic(basePoint)).toEqual(nine)
  })

  it('rejects y = 1', () => {
    const identity = new Uint8Array(32)
    identity[0] = 1
    expectReason(
      () => ed2curvePublic(asAccountPublicKey(identity)),
      'invalid_public_key'
    )
  })

  it('rejects an encoding that is not a point', () => {
    // y = 2^255 - 1 is not below the field prime.
    const nonCanonical = new Uint8Array(32).fill(0xff)
    nonCanonical[31] = 0x7f
    expectReason(
      () => ed2curvePublic(asAccountPublicKey(nonCanonical)),
      'invalid_public_key'
    )
    // Some small y has no x on the curve.
    let rejected = 0
    for (let y = 2; y < 20; y++) {
      const candidate = new Uint8Array(32)
      candidate[0] = y
      try {
        ed2curvePublic(asAccountPublicKey(candidate))
      } catch (error) {
        expect((error as { reason: string }).reason).toBe('invalid_public_key')
        rejected++
      }
    }
    expect(rejected).toBeGreaterThan(0)
  })
})

describe('ed2curve_public strict decode (section 4.4, rule 3)', () => {
  const p = (BigInt(1) << BigInt(255)) - BigInt(19)
  const encode = (y: bigint, sign = 0) => {
    const out = new Uint8Array(32)
    let rest = y
    for (let index = 0; index < 32; index++) {
      out[index] = Number(rest & BigInt(0xff))
      rest >>= BigInt(8)
    }
    out[31] |= sign << 7
    return asAccountPublicKey(out)
  }

  it('rejects a y that is not less than 2^255 - 19', () => {
    // p + 3 is another encoding of y = 3, which is a point: only the strict
    // rule rejects it. p + 1 is another encoding of y = 1.
    expect(() => ed2curvePublic(encode(BigInt(3)))).not.toThrow()
    for (const y of [
      p,
      p + BigInt(1),
      p + BigInt(3),
      p + BigInt(18),
      (BigInt(1) << BigInt(255)) - BigInt(1),
    ]) {
      for (const sign of [0, 1]) {
        expectReason(
          () => ed2curvePublic(encode(y, sign)),
          'invalid_public_key'
        )
      }
    }
    // The largest valid field element decodes or fails only by the curve.
    expect(() => ed2curvePublic(encode(p - BigInt(1)))).not.toThrow()
  })

  it('rejects a y that has no x', () => {
    // y = 2 is not on the curve.
    expectReason(() => ed2curvePublic(encode(BigInt(2))), 'invalid_public_key')
    expectReason(
      () => ed2curvePublic(encode(BigInt(2), 1)),
      'invalid_public_key'
    )
  })

  it('rejects x = 0 with the sign bit set', () => {
    // y = -1 has x = 0. RFC 8032, section 5.1.3, step 4.
    expect(() => ed2curvePublic(encode(p - BigInt(1)))).not.toThrow()
    expectReason(
      () => ed2curvePublic(encode(p - BigInt(1), 1)),
      'invalid_public_key'
    )
    // y = 1 has x = 0 too, and no X25519 form with either sign.
    expectReason(() => ed2curvePublic(encode(BigInt(1))), 'invalid_public_key')
    expectReason(
      () => ed2curvePublic(encode(BigInt(1), 1)),
      'invalid_public_key'
    )
  })

  it('gives the same u for both signs of x, and always a canonical key', () => {
    const publicKey = ed25519PublicKey<'account_public_key'>(
      asAccountPrivateKey(pattern(32, 9))
    )
    const otherSign = publicKey.slice()
    otherSign[31] ^= 0x80
    const u = ed2curvePublic(publicKey)
    expect(ed2curvePublic(asAccountPublicKey(otherSign))).toEqual(u)
    expect(isCanonicalX25519PublicKey(u)).toBe(true)
    for (let seed = 0; seed < 20; seed++) {
      const key = ed25519PublicKey<'account_public_key'>(
        asAccountPrivateKey(pattern(32, seed))
      )
      expect(isCanonicalX25519PublicKey(ed2curvePublic(key))).toBe(true)
    }
  })
})

describe('canonical X25519 public key (section 4.4, rule 3a)', () => {
  const key = (hexText: string) => hex(hexText)

  it('accepts each value below 2^255 - 19 with the highest bit zero', () => {
    for (const text of [
      '0000000000000000000000000000000000000000000000000000000000000000',
      '0900000000000000000000000000000000000000000000000000000000000000',
      // 2^255 - 20, the largest canonical value
      'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff3f',
      'edfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe7f',
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff007f',
      'ffffffffffffffffffffffffffffff00ffffffffffffffffffffffffffffff7f',
    ]) {
      expect(isCanonicalX25519PublicKey(key(text))).toBe(true)
      expect(() => assertCanonicalX25519PublicKey(key(text))).not.toThrow()
    }
  })

  it('rejects a value of 2^255 - 19 or more, and the highest bit', () => {
    for (const text of [
      'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
      'eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
      '0000000000000000000000000000000000000000000000000000000000000080',
      '0900000000000000000000000000000000000000000000000000000000000080',
      'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    ]) {
      expect(isCanonicalX25519PublicKey(key(text))).toBe(false)
      expectReason(
        () => assertCanonicalX25519PublicKey(key(text)),
        'non_canonical_public_key'
      )
      expectReason(
        () =>
          x25519SharedSecret(
            asEphemeralPrivateKey(pattern(32, 3)),
            asEphemeralPublicKey(key(text))
          ),
        'non_canonical_public_key'
      )
    }
    expect(isCanonicalX25519PublicKey(new Uint8Array(31))).toBe(false)
    expectReason(
      () => assertCanonicalX25519PublicKey(new Uint8Array(31)),
      'bad_length'
    )
  })

  it('agrees with a comparison of integers', () => {
    const prime = (BigInt(1) << BigInt(255)) - BigInt(19)
    for (let seed = 0; seed < 300; seed++) {
      const bytes = pattern(32, seed)
      // Push many samples near the prime, where the rule decides.
      if (seed % 3 === 0) bytes.fill(0xff, 1, 31)
      if (seed % 3 === 0) bytes[31] = seed % 2 ? 0x7f : 0xff
      if (seed % 6 === 0) bytes[0] = 0xe0 + (seed % 32)
      let value = BigInt(0)
      for (let index = 31; index >= 0; index--) {
        value = (value << BigInt(8)) | BigInt(bytes[index])
      }
      expect(isCanonicalX25519PublicKey(bytes)).toBe(value < prime)
    }
  })

  it('a public key that the library makes is canonical', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(
        isCanonicalX25519PublicKey(
          x25519PublicKey(asEphemeralPrivateKey(pattern(32, seed)))
        )
      ).toBe(true)
    }
  })

  it('the public key function does not change the private key (rule 3b)', () => {
    const raw = asEphemeralPrivateKey(pattern(32, 4))
    raw[0] |= 0x07
    raw[31] |= 0x80
    const before = raw.slice()
    const publicKey = x25519PublicKey(raw)
    expect(raw).toEqual(before)
    // The function clamps inside: the clamped form gives the same key.
    const clamped = before.slice()
    clamped[0] &= 248
    clamped[31] &= 127
    clamped[31] |= 64
    expect(x25519PublicKey(asEphemeralPrivateKey(clamped))).toEqual(publicKey)
  })
})

describe('protocol_version', () => {
  it('accepts version 1 and stops at each other value', () => {
    expect(PROTOCOL_VERSION).toBe(1)
    expect(() => assertSupportedProtocolVersion(1)).not.toThrow()
    for (const version of [0, 2, '1', null, undefined, 1.5]) {
      expectReason(
        () => assertSupportedProtocolVersion(version),
        'unknown_version'
      )
    }
  })
})

describe('X25519 low-order points', () => {
  // The public keys that give zeros(32) for each private key.
  const lowOrder = [
    '0000000000000000000000000000000000000000000000000000000000000000',
    '0100000000000000000000000000000000000000000000000000000000000000',
    'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800',
    '5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157',
    'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  ]
  // Other encodings of 0 and 1. They are not canonical (section 4.4, rule
  // 3a), and that rule comes first.
  const nonCanonicalLowOrder = [
    'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
    'eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
    '0000000000000000000000000000000000000000000000000000000000000080',
    '0100000000000000000000000000000000000000000000000000000000000080',
    'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b880',
  ]

  it.each(nonCanonicalLowOrder)('rejects %s as not canonical', (point) => {
    expectReason(
      () =>
        x25519SharedSecret(
          asEphemeralPrivateKey(pattern(32, 3)),
          asEphemeralPublicKey(hex(point))
        ),
      'non_canonical_public_key'
    )
  })

  it.each(lowOrder)('rejects %s', (point) => {
    expectReason(
      () =>
        x25519SharedSecret(
          asEphemeralPrivateKey(pattern(32, 3)),
          asEphemeralPublicKey(hex(point))
        ),
      'low_order_point'
    )
  })
})

describe('byte helpers', () => {
  it('LE64 is little-endian and 8 bytes', () => {
    expect(bytesToHex(le64(0))).toBe('0000000000000000')
    expect(bytesToHex(le64(1))).toBe('0100000000000000')
    expect(bytesToHex(le64(0x0102030405))).toBe('0504030201000000')
    expect(bytesToHex(le64(Number.MAX_SAFE_INTEGER))).toBe('ffffffffffff1f00')
    expectReason(() => le64(-1), 'invalid_argument')
    expectReason(() => le64(1.5), 'invalid_argument')
  })

  it('compares in constant time over the full length', () => {
    expect(constantTimeEqual(pattern(32), pattern(32))).toBe(true)
    for (let index = 0; index < 32; index++) {
      const other = pattern(32)
      other[index] ^= 0x80
      expect(constantTimeEqual(pattern(32), other)).toBe(false)
    }
    expect(constantTimeEqual(pattern(32), pattern(31))).toBe(false)
    expect(constantTimeEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true)
  })

  it('encodes hexadecimal in lower case and rejects other text', () => {
    expect(bytesToHex(Uint8Array.of(0, 0xab, 0xff))).toBe('00abff')
    expect(hexToBytes('')).toEqual(new Uint8Array(0))
    expect(hexToBytes('00abff')).toEqual(Uint8Array.of(0, 0xab, 0xff))
    expectReason(() => hexToBytes('ABFF'), 'invalid_encoding')
    expectReason(() => hexToBytes('abc'), 'invalid_encoding')
    expectReason(() => hexToBytes('zz'), 'invalid_encoding')
  })

  it('encodes base64url without padding and decodes strictly', () => {
    // RFC 4648, section 10, in the URL alphabet.
    const cases: Array<[string, string]> = [
      ['', ''],
      ['f', 'Zg'],
      ['fo', 'Zm8'],
      ['foo', 'Zm9v'],
      ['foob', 'Zm9vYg'],
      ['fooba', 'Zm9vYmE'],
      ['foobar', 'Zm9vYmFy'],
    ]
    for (const [text, encoded] of cases) {
      expect(base64urlEncode(utf8(text))).toBe(encoded)
      expect(base64urlDecode(encoded)).toEqual(utf8(text))
    }
    expect(base64urlEncode(Uint8Array.of(0xfb, 0xff))).toBe('-_8')
    for (let length = 0; length < 70; length++) {
      const bytes = pattern(length, length)
      expect(base64urlDecode(base64urlEncode(bytes))).toEqual(bytes)
    }
    expect(base64urlEncode(pattern(32))).toHaveLength(43)
    expectReason(() => base64urlDecode('Zg=='), 'invalid_encoding')
    expectReason(() => base64urlDecode('Zm+v'), 'invalid_encoding')
    expectReason(() => base64urlDecode('Z'), 'invalid_encoding')
    // 'Zh' has unused bits set: it is not the form of any byte string.
    expectReason(() => base64urlDecode('Zh'), 'invalid_encoding')
    expectReason(() => base64urlDecode('p.Zg'), 'invalid_encoding')
  })

  it('rejects a context string that is not ASCII', () => {
    expectReason(
      () => blake3DeriveKey('flare e2ee v1 café', pattern(32)),
      'invalid_argument'
    )
  })
})

describe('contexts', () => {
  it('has each context string once, all ASCII with the v1 prefix', () => {
    const values = Object.values(CONTEXTS)
    expect(new Set(values).size).toBe(values.length)
    expect(values).toHaveLength(24)
    expect(values).toContain('flare e2ee v1 one-time nonce')
    for (const value of values) {
      expect(value).toMatch(/^flare e2ee v1 [a-z-]+( [a-z]+)*$/)
    }
  })
})

describe('branded types', () => {
  it('checks the length at construction', () => {
    expect(asFileKey(pattern(32))).toHaveLength(32)
    expectReason(() => asFileKey(pattern(31)), 'bad_length')
    expectReason(() => asFileKey(pattern(33)), 'bad_length')
    expectReason(
      () => asFileKey('00'.repeat(32) as unknown as Uint8Array),
      'invalid_argument'
    )
  })

  it('does not put key bytes in an error message', () => {
    const secret = new Uint8Array(31).fill(0xab)
    try {
      asFileKey(secret)
      expect.unreachable()
    } catch (error) {
      const message = String((error as Error).message)
      expect(message).not.toContain('ab')
      expect(message).not.toContain('171')
    }
  })
})
