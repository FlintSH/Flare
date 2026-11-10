import { describe, expect, it } from 'vitest'

import {
  accountKeysFromPrivateKey,
  createAccount,
  deriveAccountKeys,
  deriveKeyringKey,
  derivePassphraseKeys,
  encodeIdentifier,
  isSignedRequestMethod,
  mnemonicFromRootEntropy,
  normalizeIdentifier,
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
} from '@/lib/e2ee/account'
import { nobleArgon2id } from '@/lib/e2ee/argon2-noble'
import { CONTEXTS } from '@/lib/e2ee/contexts'
import { V1_ARGON2ID_PARAMETERS, encodeSecretText } from '@/lib/e2ee/kdf'
import {
  asciiBytes,
  blake3DeriveKey,
  blake3Hash,
  bytesToHex,
  concatBytes,
  ed25519PublicKey,
  utf8,
  x25519PublicKey,
} from '@/lib/e2ee/primitives'
import { seal } from '@/lib/e2ee/seal'
import { derivePassphraseKeysWithParametersForTestsOnly } from '@/lib/e2ee/testing'
import {
  asAccountPrivateKey,
  asAccountPublicKey,
  asChallenge,
  asPassphraseRoot,
  asPassphraseSalt,
  asRootEntropy,
  asSealNonce,
  asWrapKey,
} from '@/lib/e2ee/types'

import {
  FAST_KDF,
  expectReason,
  expectReasonAsync,
  fakeArgon2id,
  flipBit,
  pattern,
} from './test-support'

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

  it('the sign-in function has no parameter argument and always asks for the fixed parameters', async () => {
    const { argon2id, calls } = fakeArgon2id()
    const input = {
      passphrase: 'correct horse battery staple',
      passphraseSalt: salt,
      argon2id,
      // A value that a server could try to supply. The function has no such
      // field, so it has no effect.
      kdfParameters: FAST_KDF,
      memoryKib: 8,
      passes: 1,
      lanes: 1,
    }
    const keys = await derivePassphraseKeys(input)
    expect(calls).toEqual([{ memoryKib: 65536, passes: 3, lanes: 4 }])
    expect(V1_ARGON2ID_PARAMETERS).toEqual({
      memoryKib: 65536,
      passes: 3,
      lanes: 4,
    })
    expect(Object.isFrozen(V1_ARGON2ID_PARAMETERS)).toBe(true)
    expect(keys.wrapKey).toHaveLength(32)
    expect(derivePassphraseKeys).toHaveLength(1)
  })

  it('the test-only path rejects values that are not Argon2id parameters', async () => {
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
    for (const parameters of invalid) {
      const { argon2id, calls } = fakeArgon2id()
      await expectReasonAsync(
        () =>
          derivePassphraseKeysWithParametersForTestsOnly(
            { passphrase: 'x', passphraseSalt: salt, argon2id },
            parameters
          ),
        'invalid_argument'
      )
      expect(calls).toHaveLength(0)
    }
  })

  it('the test-only path runs real Argon2id with low parameters', async () => {
    const input = {
      passphrase: 'correct horse battery staple',
      passphraseSalt: salt,
      argon2id: nobleArgon2id,
    }
    const keys = await derivePassphraseKeysWithParametersForTestsOnly(
      input,
      FAST_KDF
    )
    const again = await derivePassphraseKeysWithParametersForTestsOnly(
      input,
      FAST_KDF
    )
    expect(keys).toEqual(again)
    expect(keys.wrapKey).toEqual(
      blake3DeriveKey(CONTEXTS.wrap, keys.passphraseRoot)
    )
    const other = await derivePassphraseKeysWithParametersForTestsOnly(
      { ...input, passphrase: 'correct horse battery stapler' },
      FAST_KDF
    )
    expect(other.passphraseRoot).not.toEqual(keys.passphraseRoot)
    const otherSalt = await derivePassphraseKeysWithParametersForTestsOnly(
      { ...input, passphraseSalt: asPassphraseSalt(flipBit(salt, 0)) },
      FAST_KDF
    )
    expect(otherSalt.passphraseRoot).not.toEqual(keys.passphraseRoot)
  })

  it('the test-only path with the fixed parameters gives the keys of the sign-in function', async () => {
    const { argon2id } = fakeArgon2id()
    const input = { passphrase: 'p', passphraseSalt: salt, argon2id }
    const production = await derivePassphraseKeys(input)
    const test = await derivePassphraseKeysWithParametersForTestsOnly(
      input,
      V1_ARGON2ID_PARAMETERS
    )
    expect(test.wrapKey).toEqual(production.wrapKey)
    expect(test.authPrivateKey).toEqual(production.authPrivateKey)
  })

  it('rejects an Argon2id implementation that returns a wrong length', async () => {
    await expectReasonAsync(
      () =>
        derivePassphraseKeys({
          passphrase: 'x',
          passphraseSalt: salt,
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

  it('normalizes the identifier: NFKC, outer White_Space, lower case, UTF-8', () => {
    expect(normalizeIdentifier('  User@Example.COM ')).toBe('user@example.com')
    expect(encodeIdentifier('  User@Example.COM ')).toEqual(
      utf8('user@example.com')
    )
    // Inner white space stays.
    expect(normalizeIdentifier('a b')).toBe('a b')
    expect(normalizeIdentifier('Éric')).toBe('éric')
    // NFKC: a decomposed letter, a full-width form and a ligature.
    expect(normalizeIdentifier('E\u0301ric')).toBe('\u00e9ric')
    expect(encodeIdentifier('E\u0301ric')).toEqual(utf8('\u00e9ric'))
    expect(normalizeIdentifier('\uff35\uff53\uff45\uff52')).toBe('user')
    expect(normalizeIdentifier('\ufb01sh')).toBe('fish')
    // Each character with the property White_Space, not U+0020 only.
    const whiteSpace = [
      '\t',
      '\n',
      '\u000b',
      '\u000c',
      '\r',
      ' ',
      '\u0085',
      '\u00a0',
      '\u1680',
      '\u2000',
      '\u200a',
      '\u2028',
      '\u2029',
      '\u202f',
      '\u205f',
      '\u3000',
    ]
    for (const space of whiteSpace) {
      expect(normalizeIdentifier(`${space}${space}User${space}`)).toBe('user')
      expect(normalizeIdentifier(`a${space}b`)).toHaveLength(3)
    }
    // Not White_Space: the zero width space and the byte order mark stay.
    expect(normalizeIdentifier('\u200buser\ufeff')).toBe('\u200buser\ufeff')
    // The default mapping, without a locale: I gives i, also for Turkish.
    expect(normalizeIdentifier('TITLE')).toBe('title')
    expect(normalizeIdentifier('\u0130')).toBe('i\u0307')
    expect(normalizeIdentifier('STRASSE')).toBe('strasse')
    expect(normalizeIdentifier('\u03a3')).toBe('\u03c3')
    expect(normalizeIdentifier('')).toBe('')
    expect(normalizeIdentifier(' \t ')).toBe('')
    // The function gives the same result when it runs again.
    for (const text of ['  User ', 'E\u0301ric', '\u0130', '\ufb01sh']) {
      const once = normalizeIdentifier(text)
      expect(normalizeIdentifier(once)).toBe(once)
    }
  })

  it('signs the normalized identifier', () => {
    const keys = passphraseKeysFromRoot(asPassphraseRoot(pattern(32, 21)))
    const signature = signInSignature({
      authPrivateKey: keys.authPrivateKey,
      challenge,
      identifier: 'user@example.com',
    })
    for (const identifier of [
      ' User@Example.com\n',
      '\u00a0USER@EXAMPLE.COM\u3000',
      '\uff55ser@example.com',
    ]) {
      expect(
        signInSignature({
          authPrivateKey: keys.authPrivateKey,
          challenge,
          identifier,
        })
      ).toEqual(signature)
      expect(
        verifySignInSignature({
          authPublicKey: keys.authPublicKey,
          challenge,
          identifier,
          signature,
        })
      ).toBe(true)
    }
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

  it('uses the empty hash for no body', () => {
    const upper = signedRequestMessage({
      challenge,
      method: 'DELETE',
      path: '/',
    })
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
  })

  const NOT_UPPER_CASE_ASCII = [
    'delete',
    'Delete',
    'DELETe',
    'PÖST',
    'POS\u0422',
    'ſ',
    'ß',
    'ﬁ',
    'DELETE ',
    ' DELETE',
    'DE LETE',
    'DELETE\n',
    'GET1',
    'M-SEARCH',
    '',
  ]

  it('the message rejects a method that is not upper case ASCII', () => {
    expect(isSignedRequestMethod('DELETE')).toBe(true)
    for (const method of NOT_UPPER_CASE_ASCII) {
      expect(isSignedRequestMethod(method)).toBe(false)
      expectReason(
        () => signedRequestMessage({ challenge, method, path: '/' }),
        'invalid_argument'
      )
    }
  })

  it('the verifier rejects a method that is not upper case ASCII and does not convert it', () => {
    const request = { challenge, method: 'DELETE', path: '/api/keys' }
    const { signature } = signRequest({
      ...request,
      accountPrivateKey: accountKeys.accountPrivateKey,
    })
    const base = {
      ...request,
      accountPublicKey: accountKeys.accountPublicKey,
      signature,
    }
    expect(verifySignedRequest(base)).toBe(true)
    for (const method of ['delete', 'Delete', 'DELETe', 'DELETE ', '']) {
      expect(verifySignedRequest({ ...base, method })).toBe(false)
    }
  })

  it('the signer changes ASCII letters to upper case and nothing else', () => {
    const upper = signRequest({
      challenge,
      method: 'DELETE',
      path: '/',
      accountPrivateKey: accountKeys.accountPrivateKey,
    })
    for (const method of ['delete', 'Delete', 'dELETE']) {
      const signed = signRequest({
        challenge,
        method,
        path: '/',
        accountPrivateKey: accountKeys.accountPrivateKey,
      })
      expect(signed.signedMessage).toEqual(upper.signedMessage)
      expect(signed.signature).toEqual(upper.signature)
    }
    // Unicode upper case would give ASCII for these: SS, S, FI.
    for (const method of ['ß', 'ſ', 'ﬁ', 'pöst', 'get ', '']) {
      expectReason(
        () =>
          signRequest({
            challenge,
            method,
            path: '/',
            accountPrivateKey: accountKeys.accountPrivateKey,
          }),
        'invalid_argument'
      )
    }
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

  it('round-trips one old key', () => {
    const list = oldKeys.slice(0, 1)
    const sealedKeyring = sealKeyring({ ...base, nonce, oldPrivateKeys: list })
    expect(sealedKeyring).toHaveLength(24 + 32 + 32)
    expect(openKeyring({ ...base, sealedKeyring })).toEqual(list)
  })

  it('does not seal an empty list', () => {
    expectReason(
      () => sealKeyring({ ...base, nonce, oldPrivateKeys: [] }),
      'invalid_argument'
    )
  })

  it('rejects an authentic sealed empty list', () => {
    const sealedKeyring = seal(
      deriveKeyringKey(current.accountPrivateKey),
      nonce,
      current.accountPublicKey,
      new Uint8Array(0)
    )
    expect(sealedKeyring).toHaveLength(56)
    expectReason(() => openKeyring({ ...base, sealedKeyring }), 'bad_length')
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
    expect(calls).toEqual([V1_ARGON2ID_PARAMETERS])
    expect(record.protocolVersion).toBe(1)
    // Section 5.3: the account record does not store Argon2id parameters.
    expect(Object.keys(record).sort()).toEqual([
      'accountPublicKey',
      'authPublicKey',
      'passphraseSalt',
      'protocolVersion',
      'wrappedRoot',
    ])
    expect(record.wrappedRoot).toHaveLength(88)
    expect(rootEntropyFromMnemonic(mnemonic)).toEqual(rootEntropy)

    // Sign-in, section 6.2.
    const passphraseKeys = await derivePassphraseKeys({
      passphrase: 'correct horse battery staple',
      passphraseSalt: record.passphraseSalt,
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
})
