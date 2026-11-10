import { describe, expect, it } from 'vitest'

import { deriveAccountKeys } from './account'
import { nobleArgon2id } from './argon2-noble'
import { CONTEXTS } from './contexts'
import { deriveLinkSecretKey } from './file'
import { V1_KDF_PARAMETERS } from './kdf'
import {
  blake3DeriveKey,
  concatBytes,
  utf8,
  x25519PublicKey,
  x25519SharedSecret,
} from './primitives'
import { folderPublicKeyOf } from './records'
import { open, seal } from './seal'
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
} from './stanza'
import {
  FAST_KDF,
  expectReason,
  expectReasonAsync,
  fakeArgon2id,
  flipBit,
  hex,
  pattern,
} from './test-support'
import {
  unwrapPasswordStanzaForTestsOnly,
  wrapPasswordStanzaForTestsOnly,
} from './testing'
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
} from './types'

const accountKeys = deriveAccountKeys(asRootEntropy(pattern(32, 61)))
const otherAccountKeys = deriveAccountKeys(asRootEntropy(pattern(32, 62)))
const ephemeralPrivateKey = asEphemeralPrivateKey(pattern(32, 63))
const headerHash = asHeaderHash(pattern(32, 64))
const otherHeaderHash = asHeaderHash(pattern(32, 65))
const fileKey = asFileKey(pattern(32, 66))
const linkSecret = asLinkSecret(pattern(32, 67))
const LOW_ORDER_POINT =
  'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800'

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

  it('is ephemeral_public_key || seal(stanza_key, zeros(24), associated_data, secret)', () => {
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
        seal(
          asGenericSealKey(stanzaKey),
          asSealNonce(new Uint8Array(24)),
          associatedData,
          secret
        )
      )
    )
    expect(stanza).toHaveLength(32 + 24 + 32 + 32)
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
      () => publicUnwrap({ ...base, stanza: stanza.subarray(0, 87) }),
      'truncated'
    )
    expectReason(
      () => publicUnwrap({ ...base, stanza, secretLength: 31 }),
      'bad_length'
    )
    expectReason(
      () => publicUnwrap({ ...base, stanza: stanza.subarray(0, 119) }),
      'tag_mismatch'
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
    expect(second.subarray(56, 88)).not.toEqual(stanza.subarray(56, 88))
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
    expect(ACCOUNT_STANZA_LENGTH).toBe(120)
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
      () => unwrapAccountStanza({ ...base, stanza: stanza.subarray(0, 119) }),
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
    const { passwordKey, stanza } = await wrapPasswordStanzaForTestsOnly(
      wrapInput,
      FAST_KDF
    )
    expect(stanza).toHaveLength(PASSWORD_STANZA_LENGTH)
    expect(PASSWORD_STANZA_LENGTH).toBe(240)
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
    expect(parts.wrappedFileKey).toEqual(
      seal(passwordKey, asSealNonce(new Uint8Array(24)), headerHash, fileKey)
    )
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
    const { stanza } = await wrapPasswordStanzaForTestsOnly(wrapInput, FAST_KDF)
    const unwrapInput = {
      password: 'correct horse',
      linkSecret,
      headerHash,
      stanza,
      argon2id: nobleArgon2id,
    }
    expect(
      await unwrapPasswordStanzaForTestsOnly(unwrapInput, FAST_KDF)
    ).toEqual(fileKey)
    // NFKC: a composed and a decomposed password are the same password.
    const composed = await wrapPasswordStanzaForTestsOnly(
      { ...wrapInput, password: 'café' },
      FAST_KDF
    )
    expect(
      await unwrapPasswordStanzaForTestsOnly(
        { ...unwrapInput, password: 'café', stanza: composed.stanza },
        FAST_KDF
      )
    ).toEqual(fileKey)
  })

  it('rejects a wrong password, link secret, header_hash and each changed part', async () => {
    const { stanza } = await wrapPasswordStanzaForTestsOnly(wrapInput, FAST_KDF)
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
      // password_salt, owner_public_key, the zero nonce, wrapped key, tag
      { ...base, stanza: flipBit(stanza, 0) },
      { ...base, stanza: flipBit(stanza, 40) },
      { ...base, stanza: flipBit(stanza, 64) },
      { ...base, stanza: flipBit(stanza, 100) },
      { ...base, stanza: flipBit(stanza, 151) },
    ]
    for (const attempt of attempts) {
      await expectReasonAsync(
        () => unwrapPasswordStanzaForTestsOnly(attempt, FAST_KDF),
        'tag_mismatch'
      )
    }
    await expectReasonAsync(
      () =>
        unwrapPasswordStanzaForTestsOnly(
          { ...base, stanza: stanza.subarray(0, 239) },
          FAST_KDF
        ),
      'bad_length'
    )
    // Different Argon2id parameters give a different key.
    await expectReasonAsync(
      () =>
        unwrapPasswordStanzaForTestsOnly(base, {
          memoryKib: 16,
          passes: 1,
          lanes: 1,
        }),
      'tag_mismatch'
    )
  })

  it('lets the owner get link_secret back with file_key', async () => {
    const { stanza } = await wrapPasswordStanzaForTestsOnly(wrapInput, FAST_KDF)
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
    for (const index of [152, 176, 200, 239]) {
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
    expect(calls).toEqual([V1_KDF_PARAMETERS, V1_KDF_PARAMETERS])
  })

  it('does not open after the owner key in the stanza is replaced', async () => {
    const { stanza } = await wrapPasswordStanzaForTestsOnly(wrapInput, FAST_KDF)
    const replaced = stanza.slice()
    replaced.set(otherAccountKeys.accountPublicKey, 32)
    await expectReasonAsync(
      () =>
        unwrapPasswordStanzaForTestsOnly(
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
