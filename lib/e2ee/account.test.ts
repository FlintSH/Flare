import { describe, expect, it } from 'vitest'

import {
  accountKeysFromPrivateKey,
  createAccount,
  deriveAccountKeys,
  deriveKeyringKey,
  derivePassphraseKeys,
  encodeIdentifier,
  mnemonicFromRootEntropy,
  openKeyring,
  passphraseKeysFromRoot,
  rootEntropyFromMnemonic,
  sealKeyring,
  signInMessage,
  signInSignature,
  signRequest,
  signedRequestMessage,
  unlockAccount,
  unwrapRoot,
  verifySignInSignature,
  verifySignedRequest,
  wrapRoot,
} from './account'
import { nobleArgon2id } from './argon2-noble'
import { CONTEXTS } from './contexts'
import {
  V1_KDF_PARAMETERS,
  assertKdfParametersMeetMinimum,
  encodeSecretText,
} from './kdf'
import {
  asciiBytes,
  blake3DeriveKey,
  blake3Hash,
  bytesToHex,
  concatBytes,
  ed25519PublicKey,
  utf8,
  x25519PublicKey,
} from './primitives'
import { seal } from './seal'
import {
  FAST_KDF,
  expectReason,
  expectReasonAsync,
  fakeArgon2id,
  flipBit,
  pattern,
} from './test-support'
import { derivePassphraseKeysForTestsOnly } from './testing'
import {
  asAccountPrivateKey,
  asAccountPublicKey,
  asChallenge,
  asPassphraseRoot,
  asPassphraseSalt,
  asRootEntropy,
  asSealNonce,
  asWrapKey,
} from './types'

const rootEntropy = asRootEntropy(pattern(32, 11))
const salt = asPassphraseSalt(pattern(32, 12))
const nonce = asSealNonce(pattern(24, 13))
const challenge = asChallenge(pattern(32, 14))

describe('mnemonic', () => {
  it('matches the BIP39 vector for 32 zero bytes', () => {
    const words = mnemonicFromRootEntropy(asRootEntropy(new Uint8Array(32)))
    expect(words).toBe('abandon '.repeat(23) + 'art')
  })

  it('round-trips and has 24 words', () => {
    const words = mnemonicFromRootEntropy(rootEntropy)
    expect(words.split(' ')).toHaveLength(24)
    expect(rootEntropyFromMnemonic(words)).toEqual(rootEntropy)
    expect(
      rootEntropyFromMnemonic(`  ${words.toUpperCase().replace(/ /g, '  \n')} `)
    ).toEqual(rootEntropy)
  })

  it('rejects a wrong checksum, a wrong word and a wrong count', () => {
    const words = mnemonicFromRootEntropy(rootEntropy).split(' ')
    const swapped = [...words]
    swapped[23] = words[23] === 'zoo' ? 'abandon' : 'zoo'
    expectReason(
      () => rootEntropyFromMnemonic(swapped.join(' ')),
      'invalid_mnemonic'
    )
    expectReason(
      () => rootEntropyFromMnemonic(['notaword', ...words.slice(1)].join(' ')),
      'invalid_mnemonic'
    )
    expectReason(
      () => rootEntropyFromMnemonic(words.slice(0, 12).join(' ')),
      'invalid_mnemonic'
    )
    // A valid 12-word mnemonic is not an account mnemonic.
    expectReason(
      () => rootEntropyFromMnemonic('abandon '.repeat(11) + 'about'),
      'invalid_mnemonic'
    )
    expectReason(() => rootEntropyFromMnemonic(''), 'invalid_mnemonic')
  })
})

describe('key hierarchy', () => {
  it('derives the account keys as section 5.1 says', () => {
    const keys = deriveAccountKeys(rootEntropy)
    const seed = blake3DeriveKey(CONTEXTS.accountSeed, rootEntropy)
    expect(keys.accountPrivateKey).toEqual(seed)
    expect(keys.accountPublicKey).toEqual(
      ed25519PublicKey(asAccountPrivateKey(seed))
    )
    expect(x25519PublicKey(keys.exchangePrivateKey)).toEqual(
      keys.exchangePublicKey
    )
    expect(accountKeysFromPrivateKey(keys.accountPrivateKey)).toEqual(keys)
  })

  it('derives independent auth and wrap keys from passphrase_root', () => {
    const root = asPassphraseRoot(pattern(32, 20))
    const keys = passphraseKeysFromRoot(root)
    expect(keys.authPrivateKey).toEqual(blake3DeriveKey(CONTEXTS.auth, root))
    expect(keys.wrapKey).toEqual(blake3DeriveKey(CONTEXTS.wrap, root))
    expect(keys.authPublicKey).toEqual(ed25519PublicKey(keys.authPrivateKey))
    expect(keys.authPrivateKey).not.toEqual(keys.wrapKey)
  })
})

describe('passphrase keys and the Argon2id minimum', () => {
  it('normalizes with NFKC, keeps spaces and encodes as UTF-8', () => {
    // U+212B ANGSTROM SIGN and A + U+030A both become U+00C5.
    expect(encodeSecretText('Å')).toEqual(utf8('Å'))
    expect(encodeSecretText('Å')).toEqual(utf8('Å'))
    // U+FB01 LATIN SMALL LIGATURE FI becomes "fi" (compatibility mapping).
    expect(encodeSecretText('ﬁ')).toEqual(utf8('fi'))
    expect(encodeSecretText('  two  spaces ')).toEqual(utf8('  two  spaces '))
  })

  it('the sign-in function rejects weak parameters before any work', async () => {
    const weak = [
      FAST_KDF,
      { memoryKib: 65535, passes: 3, lanes: 4 },
      { memoryKib: 65536, passes: 2, lanes: 4 },
      { memoryKib: 65536, passes: 3, lanes: 3 },
      { memoryKib: 2097152, passes: 1, lanes: 4 },
    ]
    for (const kdfParameters of weak) {
      const { argon2id, calls } = fakeArgon2id()
      await expectReasonAsync(
        () =>
          derivePassphraseKeys({
            passphrase: 'correct horse battery staple',
            passphraseSalt: salt,
            kdfParameters,
            argon2id,
          }),
        'weak_kdf_parameters'
      )
      expect(calls).toHaveLength(0)
    }
  })

  it('rejects values that are not Argon2id parameters', async () => {
    const invalid = [
      { memoryKib: 0, passes: 3, lanes: 4 },
      { memoryKib: 65536.5, passes: 3, lanes: 4 },
      { memoryKib: 65536, passes: 0, lanes: 4 },
      { memoryKib: 65536, passes: 3, lanes: 0 },
      { memoryKib: 65536, passes: Number.NaN, lanes: 4 },
      { memoryKib: 65536, passes: 3, lanes: 16777216 },
      { memoryKib: 16, passes: 3, lanes: 4 },
      { memoryKib: '65536', passes: 3, lanes: 4 } as unknown as typeof FAST_KDF,
    ]
    for (const kdfParameters of invalid) {
      expectReason(
        () => assertKdfParametersMeetMinimum(kdfParameters),
        'invalid_kdf_parameters'
      )
      await expectReasonAsync(
        () =>
          derivePassphraseKeysForTestsOnly({
            passphrase: 'x',
            passphraseSalt: salt,
            kdfParameters,
            argon2id: fakeArgon2id().argon2id,
          }),
        'invalid_kdf_parameters'
      )
    }
  })

  it('accepts the minimum and stronger parameters, and passes them on', async () => {
    for (const kdfParameters of [
      V1_KDF_PARAMETERS,
      { memoryKib: 131072, passes: 4, lanes: 8 },
    ]) {
      const { argon2id, calls } = fakeArgon2id()
      const keys = await derivePassphraseKeys({
        passphrase: 'correct horse battery staple',
        passphraseSalt: salt,
        kdfParameters,
        argon2id,
      })
      expect(calls).toEqual([kdfParameters])
      expect(keys.wrapKey).toHaveLength(32)
    }
  })

  it('the test-only path runs real Argon2id with low parameters', async () => {
    const input = {
      passphrase: 'correct horse battery staple',
      passphraseSalt: salt,
      kdfParameters: FAST_KDF,
      argon2id: nobleArgon2id,
    }
    const keys = await derivePassphraseKeysForTestsOnly(input)
    const again = await derivePassphraseKeysForTestsOnly(input)
    expect(keys).toEqual(again)
    expect(keys.wrapKey).toEqual(
      blake3DeriveKey(CONTEXTS.wrap, keys.passphraseRoot)
    )
    const other = await derivePassphraseKeysForTestsOnly({
      ...input,
      passphrase: 'correct horse battery stapler',
    })
    expect(other.passphraseRoot).not.toEqual(keys.passphraseRoot)
    const otherSalt = await derivePassphraseKeysForTestsOnly({
      ...input,
      passphraseSalt: asPassphraseSalt(flipBit(salt, 0)),
    })
    expect(otherSalt.passphraseRoot).not.toEqual(keys.passphraseRoot)
  })

  it('rejects an Argon2id implementation that returns a wrong length', async () => {
    await expectReasonAsync(
      () =>
        derivePassphraseKeys({
          passphrase: 'x',
          passphraseSalt: salt,
          kdfParameters: V1_KDF_PARAMETERS,
          argon2id: () => new Uint8Array(16),
        }),
      'bad_length'
    )
  })
})

describe('wrapped_root', () => {
  const accountKeys = deriveAccountKeys(rootEntropy)
  const wrapKey = asWrapKey(pattern(32, 30))
  const wrappedRoot = wrapRoot({
    wrapKey,
    nonce,
    accountPublicKey: accountKeys.accountPublicKey,
    rootEntropy,
  })

  it('has 88 bytes and is seal(wrap_key, nonce, account_public_key, root_entropy)', () => {
    expect(wrappedRoot).toHaveLength(88)
    expect(wrappedRoot).toEqual(
      seal(wrapKey, nonce, accountKeys.accountPublicKey, rootEntropy)
    )
  })

  it('unlocks to the account keys', () => {
    const input = {
      wrapKey,
      accountPublicKey: accountKeys.accountPublicKey,
      wrappedRoot,
    }
    expect(unlockAccount(input)).toEqual(accountKeys)
    expect(unwrapRoot(input).rootEntropy).toEqual(rootEntropy)
  })

  it('rejects a wrong passphrase key, a wrong public key and each changed byte', () => {
    const accountPublicKey = accountKeys.accountPublicKey
    expectReason(
      () =>
        unlockAccount({
          wrapKey: asWrapKey(flipBit(wrapKey, 0)),
          accountPublicKey,
          wrappedRoot,
        }),
      'tag_mismatch'
    )
    expectReason(
      () =>
        unlockAccount({
          wrapKey,
          accountPublicKey: asAccountPublicKey(flipBit(accountPublicKey, 5)),
          wrappedRoot,
        }),
      'tag_mismatch'
    )
    for (let index = 0; index < wrappedRoot.length; index++) {
      expectReason(
        () =>
          unlockAccount({
            wrapKey,
            accountPublicKey,
            wrappedRoot: flipBit(wrappedRoot, index),
          }),
        'tag_mismatch'
      )
    }
    expectReason(
      () =>
        unlockAccount({
          wrapKey,
          accountPublicKey,
          wrappedRoot: wrappedRoot.subarray(0, 87),
        }),
      'bad_length'
    )
  })

  it('rejects a root that does not give the account public key (step 11)', () => {
    // A record that authenticates but names the public key of other entropy.
    const otherPublicKey = deriveAccountKeys(
      asRootEntropy(pattern(32, 99))
    ).accountPublicKey
    const inconsistent = wrapRoot({
      wrapKey,
      nonce,
      accountPublicKey: otherPublicKey,
      rootEntropy,
    })
    expectReason(
      () =>
        unlockAccount({
          wrapKey,
          accountPublicKey: otherPublicKey,
          wrappedRoot: inconsistent,
        }),
      'key_mismatch'
    )
  })
})

describe('sign-in signature', () => {
  const keys = passphraseKeysFromRoot(asPassphraseRoot(pattern(32, 40)))

  it('signs "flare e2ee v1 sign-in" || challenge || blake3_hash(identifier)', () => {
    expect(signInMessage(challenge, 'user@example.com')).toEqual(
      concatBytes(
        asciiBytes('flare e2ee v1 sign-in'),
        challenge,
        blake3Hash(utf8('user@example.com'))
      )
    )
    const signature = signInSignature({
      authPrivateKey: keys.authPrivateKey,
      challenge,
      identifier: 'user@example.com',
    })
    expect(signature).toHaveLength(64)
    expect(
      verifySignInSignature({
        authPublicKey: keys.authPublicKey,
        challenge,
        identifier: 'user@example.com',
        signature,
      })
    ).toBe(true)
  })

  it('removes outer spaces and changes the identifier to lower case', () => {
    expect(encodeIdentifier('  User@Example.COM ')).toEqual(
      utf8('user@example.com')
    )
    expect(encodeIdentifier('a b')).toEqual(utf8('a b'))
    expect(encodeIdentifier('Éric')).toEqual(utf8('éric'))
    // Only U+0020 is a space here. A tab stays.
    expect(encodeIdentifier('\tuser ')).toEqual(utf8('\tuser'))
  })

  it('does not verify for a different challenge, identifier, key or signature', () => {
    const signature = signInSignature({
      authPrivateKey: keys.authPrivateKey,
      challenge,
      identifier: 'user',
    })
    const base = {
      authPublicKey: keys.authPublicKey,
      challenge,
      identifier: 'user',
      signature,
    }
    expect(verifySignInSignature(base)).toBe(true)
    expect(
      verifySignInSignature({
        ...base,
        challenge: asChallenge(flipBit(challenge, 0)),
      })
    ).toBe(false)
    expect(verifySignInSignature({ ...base, identifier: 'user2' })).toBe(false)
    expect(
      verifySignInSignature({ ...base, signature: flipBit(signature, 10) })
    ).toBe(false)
    expect(
      verifySignInSignature({ ...base, signature: signature.subarray(0, 63) })
    ).toBe(false)
    const otherKeys = passphraseKeysFromRoot(asPassphraseRoot(pattern(32, 41)))
    expect(
      verifySignInSignature({ ...base, authPublicKey: otherKeys.authPublicKey })
    ).toBe(false)
  })

  it('needs a 32-byte challenge', () => {
    expectReason(() => asChallenge(pattern(16)), 'bad_length')
  })
})

describe('signed request', () => {
  const accountKeys = deriveAccountKeys(rootEntropy)
  const body = utf8('{"a":1}')

  it('builds the message of section 6.6', () => {
    const message = signedRequestMessage({
      challenge,
      method: 'POST',
      path: '/api/keys?x=1',
      body,
    })
    expect(message).toEqual(
      concatBytes(
        asciiBytes('flare e2ee v1 request'),
        challenge,
        blake3Hash(utf8('POST /api/keys?x=1')),
        blake3Hash(body)
      )
    )
    expect(message).toHaveLength(21 + 32 + 32 + 32)
  })

  it('uses upper case for the method and the empty hash for no body', () => {
    const upper = signedRequestMessage({
      challenge,
      method: 'DELETE',
      path: '/',
    })
    expect(
      signedRequestMessage({ challenge, method: 'delete', path: '/' })
    ).toEqual(upper)
    expect(
      signedRequestMessage({
        challenge,
        method: 'DELETE',
        path: '/',
        body: new Uint8Array(0),
      })
    ).toEqual(upper)
    expect(bytesToHex(upper.subarray(85))).toBe(
      bytesToHex(blake3Hash(new Uint8Array(0)))
    )
    expectReason(
      () => signedRequestMessage({ challenge, method: 'PÖST', path: '/' }),
      'invalid_argument'
    )
    expectReason(
      () => signedRequestMessage({ challenge, method: '', path: '/' }),
      'invalid_argument'
    )
  })

  it('verifies, and fails for each changed part', () => {
    const request = { challenge, method: 'POST', path: '/api/keys', body }
    const { signature, signedMessage } = signRequest({
      ...request,
      accountPrivateKey: accountKeys.accountPrivateKey,
    })
    expect(signedMessage).toEqual(signedRequestMessage(request))
    const base = {
      ...request,
      accountPublicKey: accountKeys.accountPublicKey,
      signature,
    }
    expect(verifySignedRequest(base)).toBe(true)
    expect(verifySignedRequest({ ...base, method: 'PUT' })).toBe(false)
    expect(verifySignedRequest({ ...base, path: '/api/keys?' })).toBe(false)
    expect(verifySignedRequest({ ...base, body: utf8('{"a":2}') })).toBe(false)
    expect(verifySignedRequest({ ...base, body: undefined })).toBe(false)
    expect(
      verifySignedRequest({
        ...base,
        challenge: asChallenge(flipBit(challenge, 31)),
      })
    ).toBe(false)
    expect(
      verifySignedRequest({ ...base, signature: flipBit(signature, 0) })
    ).toBe(false)
  })

  it('a sign-in signature is not a request signature', () => {
    // The two prefixes differ, so one signed message is never the other.
    expect(signInMessage(challenge, 'user').subarray(0, 21)).not.toEqual(
      signedRequestMessage({ challenge, method: 'GET', path: '/' }).subarray(
        0,
        21
      )
    )
  })
})

describe('keyring', () => {
  const current = deriveAccountKeys(rootEntropy)
  const oldKeys = [50, 51, 52].map((seed) =>
    asAccountPrivateKey(pattern(32, seed))
  )
  const base = {
    accountPrivateKey: current.accountPrivateKey,
    accountPublicKey: current.accountPublicKey,
  }

  it('seals the concatenation of the seeds, newest first', () => {
    const sealedKeyring = sealKeyring({
      ...base,
      nonce,
      oldPrivateKeys: oldKeys,
    })
    expect(sealedKeyring).toEqual(
      seal(
        deriveKeyringKey(current.accountPrivateKey),
        nonce,
        current.accountPublicKey,
        concatBytes(...oldKeys)
      )
    )
    expect(sealedKeyring).toHaveLength(24 + 96 + 32)
    expect(openKeyring({ ...base, sealedKeyring })).toEqual(oldKeys)
  })

  it.each([0, 1])('round-trips %i old keys', (count) => {
    const list = oldKeys.slice(0, count)
    const sealedKeyring = sealKeyring({ ...base, nonce, oldPrivateKeys: list })
    expect(openKeyring({ ...base, sealedKeyring })).toEqual(list)
  })

  it('rejects a changed keyring, a wrong key and a wrong public key', () => {
    const sealedKeyring = sealKeyring({
      ...base,
      nonce,
      oldPrivateKeys: oldKeys,
    })
    for (const index of [0, 23, 24, 60, 119, 120, 151]) {
      expectReason(
        () =>
          openKeyring({
            ...base,
            sealedKeyring: flipBit(sealedKeyring, index),
          }),
        'tag_mismatch'
      )
    }
    expectReason(
      () =>
        openKeyring({
          accountPrivateKey: oldKeys[0],
          accountPublicKey: current.accountPublicKey,
          sealedKeyring,
        }),
      'tag_mismatch'
    )
    expectReason(
      () =>
        openKeyring({
          ...base,
          accountPublicKey: asAccountPublicKey(pattern(32, 77)),
          sealedKeyring,
        }),
      'tag_mismatch'
    )
  })

  it('rejects an authentic list that is not a multiple of 32 bytes', () => {
    const sealedKeyring = seal(
      deriveKeyringKey(current.accountPrivateKey),
      nonce,
      current.accountPublicKey,
      pattern(33)
    )
    expectReason(() => openKeyring({ ...base, sealedKeyring }), 'bad_length')
  })
})

describe('account creation', () => {
  it('makes a record that sign-in can unlock', async () => {
    const { argon2id, calls } = fakeArgon2id()
    const { record, accountKeys, mnemonic } = await createAccount({
      rootEntropy,
      passphrase: 'correct horse battery staple',
      passphraseSalt: salt,
      wrapNonce: nonce,
      argon2id,
    })
    expect(calls).toEqual([V1_KDF_PARAMETERS])
    expect(record.protocolVersion).toBe(1)
    expect(record.kdfParameters).toEqual(V1_KDF_PARAMETERS)
    expect(record.wrappedRoot).toHaveLength(88)
    expect(rootEntropyFromMnemonic(mnemonic)).toEqual(rootEntropy)

    // Sign-in, section 6.2.
    const passphraseKeys = await derivePassphraseKeys({
      passphrase: 'correct horse battery staple',
      passphraseSalt: record.passphraseSalt,
      kdfParameters: record.kdfParameters,
      argon2id,
    })
    expect(passphraseKeys.authPublicKey).toEqual(record.authPublicKey)
    const signature = signInSignature({
      authPrivateKey: passphraseKeys.authPrivateKey,
      challenge,
      identifier: 'user',
    })
    expect(
      verifySignInSignature({
        authPublicKey: record.authPublicKey,
        challenge,
        identifier: 'user',
        signature,
      })
    ).toBe(true)
    expect(
      unlockAccount({
        wrapKey: passphraseKeys.wrapKey,
        accountPublicKey: record.accountPublicKey,
        wrappedRoot: record.wrappedRoot,
      })
    ).toEqual(accountKeys)

    // A wrong passphrase gives a wrong wrap key.
    const wrong = await derivePassphraseKeys({
      passphrase: 'Correct horse battery staple',
      passphraseSalt: record.passphraseSalt,
      kdfParameters: record.kdfParameters,
      argon2id,
    })
    expectReason(
      () =>
        unlockAccount({
          wrapKey: wrong.wrapKey,
          accountPublicKey: record.accountPublicKey,
          wrappedRoot: record.wrappedRoot,
        }),
      'tag_mismatch'
    )
  })

  it('refuses to create an account with weak parameters', async () => {
    await expectReasonAsync(
      () =>
        createAccount({
          rootEntropy,
          passphrase: 'x',
          passphraseSalt: salt,
          wrapNonce: nonce,
          argon2id: fakeArgon2id().argon2id,
          kdfParameters: FAST_KDF,
        }),
      'weak_kdf_parameters'
    )
  })
})
