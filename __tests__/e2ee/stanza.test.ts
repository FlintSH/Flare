import { describe, expect, it } from 'vitest'

import { deriveAccountKeys } from '@/lib/e2ee/account'
import { nobleArgon2id } from '@/lib/e2ee/argon2-noble'
import { CONTEXTS } from '@/lib/e2ee/contexts'
import { deriveLinkSecretKey } from '@/lib/e2ee/file'
import { V1_ARGON2ID_PARAMETERS } from '@/lib/e2ee/kdf'
import {
  blake3DeriveKey,
  concatBytes,
  utf8,
  x25519PublicKey,
  x25519SharedSecret,
} from '@/lib/e2ee/primitives'
import { folderPublicKeyOf } from '@/lib/e2ee/records'
import { open, openOnce, seal, sealOnce } from '@/lib/e2ee/seal'
import {
  ACCOUNT_STANZA_LENGTH,
  PASSWORD_STANZA_LENGTH,
  openSealedLinkSecret,
  parsePasswordStanza,
  publicUnwrap,
  publicWrap,
  unwrapAccountStanza,
  unwrapFolderFileStanza,
  unwrapFolderLinkSecretStanza,
  unwrapParentFolderStanza,
  unwrapPasswordStanza,
  wrapAccountStanza,
  wrapFolderFileStanza,
  wrapFolderLinkSecretStanza,
  wrapParentFolderStanza,
  wrapPasswordStanza,
} from '@/lib/e2ee/stanza'
import {
  unwrapPasswordStanzaWithParametersForTestsOnly,
  wrapPasswordStanzaWithParametersForTestsOnly,
} from '@/lib/e2ee/testing'
import {
  asAccountPublicKey,
  asEphemeralPrivateKey,
  asExchangePublicKey,
  asFileKey,
  asFolderPrivateKey,
  asFolderPublicKey,
  asGenericSealKey,
  asHeaderHash,
  asLinkSecret,
  asPasswordSalt,
  asRootEntropy,
  asSealNonce,
} from '@/lib/e2ee/types'

import {
  FAST_KDF,
  expectReason,
  expectReasonAsync,
  fakeArgon2id,
  flipBit,
  hex,
  pattern,
} from './test-support'

const accountKeys = deriveAccountKeys(asRootEntropy(pattern(32, 61)))
const otherAccountKeys = deriveAccountKeys(asRootEntropy(pattern(32, 62)))
const ephemeralPrivateKey = asEphemeralPrivateKey(pattern(32, 63))
const headerHash = asHeaderHash(pattern(32, 64))
const otherHeaderHash = asHeaderHash(pattern(32, 65))
const fileKey = asFileKey(pattern(32, 66))
const linkSecret = asLinkSecret(pattern(32, 67))
const LOW_ORDER_POINT =
  'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800'
/** Section 4.4, rule 3a: a value of 2^255 - 19 or more, or the highest bit set. */
const NON_CANONICAL_KEYS = [
  // 2^255 - 19, the same point as 0
  'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  // 2^255 - 18, the same point as 1
  'eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  // 2^255 - 1
  'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  // 9 with the highest bit set
  '0900000000000000000000000000000000000000000000000000000000000080',
  // 2^256 - 1
  'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
]

describe('public_wrap', () => {
  const recipientPrivateKey = asFolderPrivateKey(pattern(32, 70))
  const recipientPublicKey = folderPublicKeyOf(recipientPrivateKey)
  const context = CONTEXTS.folderFileStanza
  const associatedData = utf8('associated data')
  const secret = pattern(32, 71)
  const stanza = publicWrap({
    recipientPublicKey,
    ephemeralPrivateKey,
    context,
    associatedData,
    secret,
  })

  it('is ephemeral_public_key || seal_once(stanza_key, associated_data, secret)', () => {
    const ephemeralPublicKey = x25519PublicKey(ephemeralPrivateKey)
    const sharedSecret = x25519SharedSecret(
      ephemeralPrivateKey,
      recipientPublicKey
    )
    const stanzaKey = blake3DeriveKey(
      context,
      concatBytes(sharedSecret, ephemeralPublicKey, recipientPublicKey)
    )
    expect(stanza).toEqual(
      concatBytes(
        ephemeralPublicKey,
        sealOnce(asGenericSealKey(stanzaKey), associatedData, secret)
      )
    )
    // No nonce: the public key, the ciphertext and the tag.
    expect(stanza).toHaveLength(32 + 32 + 32)
    // The sealed part is the box of section 4.2 with the derived nonce,
    // without that nonce.
    const nonce = blake3DeriveKey(
      'flare e2ee v1 one-time nonce',
      stanzaKey
    ).subarray(0, 24)
    expect(stanza.subarray(32)).toEqual(
      seal(
        asGenericSealKey(stanzaKey),
        asSealNonce(nonce),
        associatedData,
        secret
      ).subarray(24)
    )
    expect(
      openOnce(asGenericSealKey(stanzaKey), associatedData, stanza.subarray(32))
    ).toEqual(secret)
  })

  it('does not use a zero nonce', () => {
    const ephemeralPublicKey = x25519PublicKey(ephemeralPrivateKey)
    const stanzaKey = asGenericSealKey(
      blake3DeriveKey(
        context,
        concatBytes(
          x25519SharedSecret(ephemeralPrivateKey, recipientPublicKey),
          ephemeralPublicKey,
          recipientPublicKey
        )
      )
    )
    const withZeroNonce = seal(
      stanzaKey,
      asSealNonce(new Uint8Array(24)),
      associatedData,
      secret
    )
    expect(stanza.subarray(32)).not.toEqual(withZeroNonce.subarray(24))
    // A stanza in the form of draft 17 does not open.
    expectReason(
      () =>
        publicUnwrap({
          recipientPrivateKey,
          context,
          associatedData,
          stanza: concatBytes(ephemeralPublicKey, withZeroNonce),
        }),
      'tag_mismatch'
    )
    expectReason(
      () =>
        publicUnwrap({
          recipientPrivateKey,
          context,
          associatedData,
          stanza: concatBytes(ephemeralPublicKey, withZeroNonce),
          secretLength: 32,
        }),
      'bad_length'
    )
  })

  it('round-trips secrets of several lengths', () => {
    expect(
      publicUnwrap({ recipientPrivateKey, context, associatedData, stanza })
    ).toEqual(secret)
    for (const length of [0, 1, 64]) {
      const wrapped = publicWrap({
        recipientPublicKey,
        ephemeralPrivateKey,
        context,
        associatedData,
        secret: pattern(length),
      })
      expect(
        publicUnwrap({
          recipientPrivateKey,
          context,
          associatedData,
          stanza: wrapped,
        })
      ).toEqual(pattern(length))
    }
  })

  it('rejects each changed byte of the stanza', () => {
    for (let index = 0; index < stanza.length; index++) {
      expectReason(
        () =>
          publicUnwrap({
            recipientPrivateKey,
            context,
            associatedData,
            stanza: flipBit(stanza, index),
          }),
        'tag_mismatch'
      )
    }
  })

  it('rejects a wrong key, context or associated data', () => {
    const base = { recipientPrivateKey, context, associatedData, stanza }
    expectReason(
      () =>
        publicUnwrap({
          ...base,
          recipientPrivateKey: asFolderPrivateKey(pattern(32, 72)),
        }),
      'tag_mismatch'
    )
    expectReason(
      () => publicUnwrap({ ...base, context: CONTEXTS.accountStanza }),
      'tag_mismatch'
    )
    expectReason(
      () => publicUnwrap({ ...base, associatedData: utf8('other') }),
      'tag_mismatch'
    )
  })

  it('rejects a short stanza and a wrong secret length', () => {
    const base = { recipientPrivateKey, context, associatedData }
    expectReason(
      () => publicUnwrap({ ...base, stanza: stanza.subarray(0, 63) }),
      'truncated'
    )
    expectReason(
      () => publicUnwrap({ ...base, stanza, secretLength: 31 }),
      'bad_length'
    )
    expectReason(
      () => publicUnwrap({ ...base, stanza: stanza.subarray(0, 95) }),
      'tag_mismatch'
    )
    // The shortest stanza: an empty secret.
    const empty = publicWrap({
      recipientPublicKey,
      ephemeralPrivateKey,
      context,
      associatedData,
      secret: new Uint8Array(0),
    })
    expect(empty).toHaveLength(64)
    expect(publicUnwrap({ ...base, stanza: empty })).toEqual(new Uint8Array(0))
  })

  it('rejects a recipient public key that is not canonical', () => {
    for (const key of NON_CANONICAL_KEYS) {
      expectReason(
        () =>
          publicWrap({
            recipientPublicKey: asFolderPublicKey(hex(key)),
            ephemeralPrivateKey,
            context,
            associatedData,
            secret,
          }),
        'non_canonical_public_key'
      )
    }
  })

  it('rejects an ephemeral public key that is not canonical', () => {
    for (const key of NON_CANONICAL_KEYS) {
      expectReason(
        () =>
          publicUnwrap({
            recipientPrivateKey,
            context,
            associatedData,
            stanza: concatBytes(hex(key), stanza.subarray(32)),
          }),
        'non_canonical_public_key'
      )
    }
    // The same point with the highest bit set gives the same shared secret
    // in RFC 7748, so without the rule this second form would open.
    const sameKeyOtherForm = stanza.slice()
    sameKeyOtherForm[31] |= 0x80
    expectReason(
      () =>
        publicUnwrap({
          recipientPrivateKey,
          context,
          associatedData,
          stanza: sameKeyOtherForm,
        }),
      'non_canonical_public_key'
    )
  })

  it('rejects an all-zero shared secret on both sides', () => {
    expectReason(
      () =>
        publicWrap({
          recipientPublicKey: asFolderPublicKey(hex(LOW_ORDER_POINT)),
          ephemeralPrivateKey,
          context,
          associatedData,
          secret,
        }),
      'low_order_point'
    )
    expectReason(
      () =>
        publicWrap({
          recipientPublicKey: asFolderPublicKey(new Uint8Array(32)),
          ephemeralPrivateKey,
          context,
          associatedData,
          secret,
        }),
      'low_order_point'
    )
    // A stanza whose ephemeral public key is a low-order point.
    const forged = concatBytes(hex(LOW_ORDER_POINT), stanza.subarray(32))
    expectReason(
      () =>
        publicUnwrap({
          recipientPrivateKey,
          context,
          associatedData,
          stanza: forged,
        }),
      'low_order_point'
    )
  })

  it('gives a different stanza for a different ephemeral key', () => {
    const second = publicWrap({
      recipientPublicKey,
      ephemeralPrivateKey: asEphemeralPrivateKey(pattern(32, 73)),
      context,
      associatedData,
      secret,
    })
    expect(second).not.toEqual(stanza)
    expect(second.subarray(32, 64)).not.toEqual(stanza.subarray(32, 64))
  })
})

describe('account stanza', () => {
  const stanza = wrapAccountStanza({
    accountPublicKey: accountKeys.accountPublicKey,
    ephemeralPrivateKey,
    headerHash,
    fileKey,
  })

  it('is public_wrap to the exchange key with the account stanza context', () => {
    expect(stanza).toHaveLength(ACCOUNT_STANZA_LENGTH)
    expect(ACCOUNT_STANZA_LENGTH).toBe(96)
    expect(stanza).toEqual(
      publicWrap({
        recipientPublicKey: accountKeys.exchangePublicKey,
        ephemeralPrivateKey,
        context: 'flare e2ee v1 account stanza',
        associatedData: headerHash,
        secret: fileKey,
      })
    )
  })

  it('opens with the account private key', () => {
    expect(
      unwrapAccountStanza({
        accountPrivateKey: accountKeys.accountPrivateKey,
        headerHash,
        stanza,
      })
    ).toEqual(fileKey)
  })

  it('rejects a wrong key, a wrong header_hash and each changed byte', () => {
    const base = {
      accountPrivateKey: accountKeys.accountPrivateKey,
      headerHash,
      stanza,
    }
    expectReason(
      () =>
        unwrapAccountStanza({
          ...base,
          accountPrivateKey: otherAccountKeys.accountPrivateKey,
        }),
      'tag_mismatch'
    )
    expectReason(
      () => unwrapAccountStanza({ ...base, headerHash: otherHeaderHash }),
      'tag_mismatch'
    )
    for (let index = 0; index < stanza.length; index++) {
      expectReason(
        () => unwrapAccountStanza({ ...base, stanza: flipBit(stanza, index) }),
        'tag_mismatch'
      )
    }
    expectReason(
      () => unwrapAccountStanza({ ...base, stanza: stanza.subarray(0, 95) }),
      'bad_length'
    )
    expectReason(
      () =>
        unwrapAccountStanza({
          ...base,
          stanza: concatBytes(stanza, Uint8Array.of(0)),
        }),
      'bad_length'
    )
  })

  it('does not open as a folder stanza of the same key', () => {
    // The same X25519 key and header hash, a different context.
    expectReason(
      () =>
        publicUnwrap({
          recipientPrivateKey: accountKeys.exchangePrivateKey,
          context: CONTEXTS.folderFileStanza,
          associatedData: headerHash,
          stanza,
        }),
      'tag_mismatch'
    )
  })

  it('rejects an account public key with no X25519 form', () => {
    const identity = new Uint8Array(32)
    identity[0] = 1
    expectReason(
      () =>
        wrapAccountStanza({
          accountPublicKey: asAccountPublicKey(identity),
          ephemeralPrivateKey,
          headerHash,
          fileKey,
        }),
      'invalid_public_key'
    )
    // The point of order 2 (y = -1) converts to u = 0, which X25519 rejects.
    const orderTwo = hex(
      'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f'
    )
    expectReason(
      () =>
        wrapAccountStanza({
          accountPublicKey: asAccountPublicKey(orderTwo),
          ephemeralPrivateKey,
          headerHash,
          fileKey,
        }),
      'low_order_point'
    )
  })
})

describe('password stanza', () => {
  const passwordSalt = asPasswordSalt(pattern(32, 80))
  const linkSecretNonce = asSealNonce(pattern(24, 81))
  const wrapInput = {
    password: 'correct horse',
    passwordSalt,
    linkSecret,
    ownerPublicKey: accountKeys.accountPublicKey,
    headerHash,
    fileKey,
    linkSecretNonce,
    argon2id: nobleArgon2id,
  }

  it('has the layout of section 8.2', async () => {
    const { passwordKey, stanza } =
      await wrapPasswordStanzaWithParametersForTestsOnly(wrapInput, FAST_KDF)
    expect(stanza).toHaveLength(PASSWORD_STANZA_LENGTH)
    expect(PASSWORD_STANZA_LENGTH).toBe(32 + 32 + 64 + 88)
    const parts = parsePasswordStanza(stanza)
    expect(parts.passwordSalt).toEqual(passwordSalt)
    expect(parts.ownerPublicKey).toEqual(accountKeys.accountPublicKey)

    const stretched = await nobleArgon2id({
      password: utf8('correct horse'),
      salt: passwordSalt,
      memoryKib: FAST_KDF.memoryKib,
      passes: FAST_KDF.passes,
      lanes: FAST_KDF.lanes,
      outputLength: 32,
    })
    expect(passwordKey).toEqual(
      blake3DeriveKey(
        CONTEXTS.passwordStanza,
        concatBytes(
          stretched,
          linkSecret,
          accountKeys.accountPublicKey,
          headerHash
        )
      )
    )
    // seal_once: 64 bytes, no nonce, and not the box of a zero nonce.
    expect(parts.wrappedFileKey).toHaveLength(64)
    expect(parts.wrappedFileKey).toEqual(
      sealOnce(passwordKey, headerHash, fileKey)
    )
    expect(parts.wrappedFileKey).not.toEqual(
      seal(
        passwordKey,
        asSealNonce(new Uint8Array(24)),
        headerHash,
        fileKey
      ).subarray(24)
    )
    // sealed_link_secret keeps a random nonce: 88 bytes.
    expect(parts.sealedLinkSecret).toHaveLength(88)
    expect(parts.sealedLinkSecret).toEqual(
      seal(
        deriveLinkSecretKey(fileKey),
        linkSecretNonce,
        headerHash,
        linkSecret
      )
    )
  })

  it('opens with the password and the link secret', async () => {
    const { stanza } = await wrapPasswordStanzaWithParametersForTestsOnly(
      wrapInput,
      FAST_KDF
    )
    const unwrapInput = {
      password: 'correct horse',
      linkSecret,
      headerHash,
      stanza,
      argon2id: nobleArgon2id,
    }
    expect(
      await unwrapPasswordStanzaWithParametersForTestsOnly(
        unwrapInput,
        FAST_KDF
      )
    ).toEqual(fileKey)
    // NFKC: a composed and a decomposed password are the same password.
    const composed = await wrapPasswordStanzaWithParametersForTestsOnly(
      { ...wrapInput, password: 'café' },
      FAST_KDF
    )
    expect(
      await unwrapPasswordStanzaWithParametersForTestsOnly(
        { ...unwrapInput, password: 'café', stanza: composed.stanza },
        FAST_KDF
      )
    ).toEqual(fileKey)
  })

  it('rejects a wrong password, link secret, header_hash and each changed part', async () => {
    const { stanza } = await wrapPasswordStanzaWithParametersForTestsOnly(
      wrapInput,
      FAST_KDF
    )
    const base = {
      password: 'correct horse',
      linkSecret,
      headerHash,
      stanza,
      argon2id: nobleArgon2id,
    }
    const attempts = [
      { ...base, password: 'correct horse ' },
      { ...base, linkSecret: asLinkSecret(flipBit(linkSecret, 0)) },
      { ...base, headerHash: otherHeaderHash },
      // password_salt, owner_public_key, wrapped key, its tag
      { ...base, stanza: flipBit(stanza, 0) },
      { ...base, stanza: flipBit(stanza, 40) },
      { ...base, stanza: flipBit(stanza, 64) },
      { ...base, stanza: flipBit(stanza, 100) },
      { ...base, stanza: flipBit(stanza, 127) },
    ]
    for (const attempt of attempts) {
      await expectReasonAsync(
        () => unwrapPasswordStanzaWithParametersForTestsOnly(attempt, FAST_KDF),
        'tag_mismatch'
      )
    }
    await expectReasonAsync(
      () =>
        unwrapPasswordStanzaWithParametersForTestsOnly(
          { ...base, stanza: stanza.subarray(0, 215) },
          FAST_KDF
        ),
      'bad_length'
    )
    // Different Argon2id parameters give a different key.
    await expectReasonAsync(
      () =>
        unwrapPasswordStanzaWithParametersForTestsOnly(base, {
          memoryKib: 16,
          passes: 1,
          lanes: 1,
        }),
      'tag_mismatch'
    )
  })

  it('lets the owner get link_secret back with file_key', async () => {
    const { stanza } = await wrapPasswordStanzaWithParametersForTestsOnly(
      wrapInput,
      FAST_KDF
    )
    expect(openSealedLinkSecret({ fileKey, headerHash, stanza })).toEqual(
      linkSecret
    )
    expectReason(
      () =>
        openSealedLinkSecret({
          fileKey: asFileKey(pattern(32, 90)),
          headerHash,
          stanza,
        }),
      'tag_mismatch'
    )
    expectReason(
      () =>
        openSealedLinkSecret({
          fileKey,
          headerHash: otherHeaderHash,
          stanza,
        }),
      'tag_mismatch'
    )
    for (const index of [128, 152, 176, 215]) {
      expectReason(
        () =>
          openSealedLinkSecret({
            fileKey,
            headerHash,
            stanza: flipBit(stanza, index),
          }),
        'tag_mismatch'
      )
    }
  })

  it('the production path always uses the parameters of protocol version 1', async () => {
    const { argon2id, calls } = fakeArgon2id()
    const stanza = await wrapPasswordStanza({ ...wrapInput, argon2id })
    expect(
      await unwrapPasswordStanza({
        password: 'correct horse',
        linkSecret,
        headerHash,
        stanza,
        argon2id,
      })
    ).toEqual(fileKey)
    expect(calls).toEqual([V1_ARGON2ID_PARAMETERS, V1_ARGON2ID_PARAMETERS])
    // The production functions take one argument: no parameters.
    expect(wrapPasswordStanza).toHaveLength(1)
    expect(unwrapPasswordStanza).toHaveLength(1)
  })

  it('does not open after the owner key in the stanza is replaced', async () => {
    const { stanza } = await wrapPasswordStanzaWithParametersForTestsOnly(
      wrapInput,
      FAST_KDF
    )
    const replaced = stanza.slice()
    replaced.set(otherAccountKeys.accountPublicKey, 32)
    await expectReasonAsync(
      () =>
        unwrapPasswordStanzaWithParametersForTestsOnly(
          {
            password: 'correct horse',
            linkSecret,
            headerHash,
            stanza: replaced,
            argon2id: nobleArgon2id,
          },
          FAST_KDF
        ),
      'tag_mismatch'
    )
  })
})

describe('folder stanzas', () => {
  const folderPrivateKey = asFolderPrivateKey(pattern(32, 100))
  const folderPublicKey = folderPublicKeyOf(folderPrivateKey)
  const childPrivateKey = asFolderPrivateKey(pattern(32, 101))
  const childPublicKey = folderPublicKeyOf(childPrivateKey)

  it('folder file stanza round-trips and binds the header_hash', () => {
    const stanza = wrapFolderFileStanza({
      folderPublicKey,
      ephemeralPrivateKey,
      headerHash,
      fileKey,
    })
    expect(stanza).toEqual(
      publicWrap({
        recipientPublicKey: folderPublicKey,
        ephemeralPrivateKey,
        context: 'flare e2ee v1 folder file stanza',
        associatedData: headerHash,
        secret: fileKey,
      })
    )
    expect(
      unwrapFolderFileStanza({ folderPrivateKey, headerHash, stanza })
    ).toEqual(fileKey)
    expectReason(
      () =>
        unwrapFolderFileStanza({
          folderPrivateKey,
          headerHash: otherHeaderHash,
          stanza,
        }),
      'tag_mismatch'
    )
    expectReason(
      () =>
        unwrapFolderFileStanza({
          folderPrivateKey: childPrivateKey,
          headerHash,
          stanza,
        }),
      'tag_mismatch'
    )
    expectReason(
      () =>
        unwrapFolderFileStanza({
          folderPrivateKey,
          headerHash,
          stanza: flipBit(stanza, 60),
        }),
      'tag_mismatch'
    )
  })

  it('folder link secret stanza round-trips and is not a file stanza', () => {
    const stanza = wrapFolderLinkSecretStanza({
      folderPublicKey,
      ephemeralPrivateKey,
      headerHash,
      linkSecret,
    })
    expect(stanza).toEqual(
      publicWrap({
        recipientPublicKey: folderPublicKey,
        ephemeralPrivateKey,
        context: 'flare e2ee v1 folder link secret stanza',
        associatedData: headerHash,
        secret: linkSecret,
      })
    )
    expect(
      unwrapFolderLinkSecretStanza({ folderPrivateKey, headerHash, stanza })
    ).toEqual(linkSecret)
    // A visitor must not be able to read a link secret as a file key.
    expectReason(
      () => unwrapFolderFileStanza({ folderPrivateKey, headerHash, stanza }),
      'tag_mismatch'
    )
  })

  it('parent folder stanza gives the private key of the folder below', () => {
    const stanza = wrapParentFolderStanza({
      parentFolderPublicKey: folderPublicKey,
      ephemeralPrivateKey,
      folderPrivateKey: childPrivateKey,
    })
    expect(stanza).toEqual(
      publicWrap({
        recipientPublicKey: folderPublicKey,
        ephemeralPrivateKey,
        context: 'flare e2ee v1 parent folder stanza',
        associatedData: childPublicKey,
        secret: childPrivateKey,
      })
    )
    expect(
      unwrapParentFolderStanza({
        parentFolderPrivateKey: folderPrivateKey,
        folderPublicKey: childPublicKey,
        stanza,
      })
    ).toEqual(childPrivateKey)
    // The key of the child does not open the stanza: no way up the tree.
    expectReason(
      () =>
        unwrapParentFolderStanza({
          parentFolderPrivateKey: childPrivateKey,
          folderPublicKey: childPublicKey,
          stanza,
        }),
      'tag_mismatch'
    )
    expectReason(
      () =>
        unwrapParentFolderStanza({
          parentFolderPrivateKey: folderPrivateKey,
          folderPublicKey,
          stanza,
        }),
      'tag_mismatch'
    )
  })

  it('rejects a parent folder stanza whose key does not give the listed public key', () => {
    // Anyone with folder_public_key can make a stanza. This one authenticates
    // with the listed public key but carries a different private key.
    const forged = publicWrap({
      recipientPublicKey: folderPublicKey,
      ephemeralPrivateKey,
      context: CONTEXTS.parentFolderStanza,
      associatedData: childPublicKey,
      secret: pattern(32, 102),
    })
    expectReason(
      () =>
        unwrapParentFolderStanza({
          parentFolderPrivateKey: folderPrivateKey,
          folderPublicKey: childPublicKey,
          stanza: forged,
        }),
      'key_mismatch'
    )
  })

  it('rejects a folder public key that is not canonical', () => {
    const stanza = wrapParentFolderStanza({
      parentFolderPublicKey: folderPublicKey,
      ephemeralPrivateKey,
      folderPrivateKey: childPrivateKey,
    })
    for (const key of NON_CANONICAL_KEYS) {
      const nonCanonical = asFolderPublicKey(hex(key))
      expectReason(
        () =>
          wrapFolderFileStanza({
            folderPublicKey: nonCanonical,
            ephemeralPrivateKey,
            headerHash,
            fileKey,
          }),
        'non_canonical_public_key'
      )
      expectReason(
        () =>
          wrapFolderLinkSecretStanza({
            folderPublicKey: nonCanonical,
            ephemeralPrivateKey,
            headerHash,
            linkSecret,
          }),
        'non_canonical_public_key'
      )
      expectReason(
        () =>
          wrapParentFolderStanza({
            parentFolderPublicKey: nonCanonical,
            ephemeralPrivateKey,
            folderPrivateKey: childPrivateKey,
          }),
        'non_canonical_public_key'
      )
      // The listed public key of the folder below.
      expectReason(
        () =>
          unwrapParentFolderStanza({
            parentFolderPrivateKey: folderPrivateKey,
            folderPublicKey: nonCanonical,
            stanza,
          }),
        'non_canonical_public_key'
      )
    }
  })

  it('wraps a folder private key as it is, without clamping', () => {
    // Bits that clamping would change: the low 3 bits and the top 2 bits.
    const raw = asFolderPrivateKey(pattern(32, 106))
    raw[0] |= 0x07
    raw[31] |= 0x80
    raw[31] &= 0xbf
    const stanza = wrapParentFolderStanza({
      parentFolderPublicKey: folderPublicKey,
      ephemeralPrivateKey,
      folderPrivateKey: raw,
    })
    const opened = unwrapParentFolderStanza({
      parentFolderPrivateKey: folderPrivateKey,
      folderPublicKey: folderPublicKeyOf(raw),
      stanza,
    })
    expect(opened).toEqual(raw)
    expect(opened[0] & 0x07).toBe(0x07)
    expect(opened[31] & 0xc0).toBe(0x80)
  })

  it('opens a chain of folders from the top key only', () => {
    const grandchildPrivateKey = asFolderPrivateKey(pattern(32, 103))
    const toChild = wrapParentFolderStanza({
      parentFolderPublicKey: folderPublicKey,
      ephemeralPrivateKey,
      folderPrivateKey: childPrivateKey,
    })
    const toGrandchild = wrapParentFolderStanza({
      parentFolderPublicKey: childPublicKey,
      ephemeralPrivateKey: asEphemeralPrivateKey(pattern(32, 104)),
      folderPrivateKey: grandchildPrivateKey,
    })
    const fileStanza = wrapFolderFileStanza({
      folderPublicKey: folderPublicKeyOf(grandchildPrivateKey),
      ephemeralPrivateKey: asEphemeralPrivateKey(pattern(32, 105)),
      headerHash,
      fileKey,
    })
    const child = unwrapParentFolderStanza({
      parentFolderPrivateKey: folderPrivateKey,
      folderPublicKey: childPublicKey,
      stanza: toChild,
    })
    const grandchild = unwrapParentFolderStanza({
      parentFolderPrivateKey: child,
      folderPublicKey: folderPublicKeyOf(grandchildPrivateKey),
      stanza: toGrandchild,
    })
    expect(
      unwrapFolderFileStanza({
        folderPrivateKey: grandchild,
        headerHash,
        stanza: fileStanza,
      })
    ).toEqual(fileKey)
  })
})

describe('stanza keys and seal', () => {
  it('an account stanza body does not open with the raw shared secret', () => {
    // The stanza key is derived, never the shared secret itself.
    const stanza = wrapAccountStanza({
      accountPublicKey: accountKeys.accountPublicKey,
      ephemeralPrivateKey,
      headerHash,
      fileKey,
    })
    const sharedSecret = x25519SharedSecret(
      accountKeys.exchangePrivateKey,
      asExchangePublicKey(stanza.slice(0, 32))
    )
    expectReason(
      () =>
        open(asGenericSealKey(sharedSecret), headerHash, stanza.subarray(32)),
      'tag_mismatch'
    )
  })
})
