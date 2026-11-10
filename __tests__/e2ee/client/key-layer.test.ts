import { describe, expect, it } from 'vitest'

import { accountRecordSchema } from '@/lib/auth/e2ee/records'
import {
  accountKeysFromPrivateKey,
  derivePassphraseKeys,
  mnemonicFromRootEntropy,
  openKeyring,
  unwrapRoot,
  verifySignedRequest,
} from '@/lib/e2ee/account'
import {
  type KeyStore,
  type StoredAccountKeys,
  createMemoryKeyStore,
  readStoredAccountKeys,
} from '@/lib/e2ee/client/key-store'
import {
  MAX_KEYRING_KEYS,
  accountKeysFromMnemonic,
  createNewAccount,
  createRotation,
  openAccount,
  wipePassphraseKeys,
} from '@/lib/e2ee/client/procedures'
import {
  SIGNED_REQUEST_CHALLENGE_HEADER,
  SIGNED_REQUEST_SIGNATURE_HEADER,
  buildSignedRequest,
} from '@/lib/e2ee/client/signed-request'
import {
  type AccountKeyState,
  INITIAL_ACCOUNT_KEY_STATE,
  type ServerKeyStatus,
  storedKeysMatch,
  transitionAccountKeys,
} from '@/lib/e2ee/client/state'
import {
  accountRecordToWire,
  assertKnownProtocolVersion,
  sealedKeyringFromWire,
  sealedKeyringToWire,
  wrappedRootFromWire,
} from '@/lib/e2ee/client/wire'
import {
  base64urlDecode,
  base64urlEncode,
  isAllZero,
  utf8,
} from '@/lib/e2ee/primitives'
import { generateRootEntropy, randomBytes } from '@/lib/e2ee/random'
import type {
  AccountPrivateKey,
  AccountPublicKey,
  Challenge,
} from '@/lib/e2ee/types'

import { expectReason, expectReasonAsync, fakeArgon2id } from '../test-support'

function storedKeys(userId: string, seed = 1): StoredAccountKeys {
  const keys = accountKeysFromPrivateKey(
    new Uint8Array(32).fill(seed) as AccountPrivateKey
  )
  return {
    userId,
    accountPublicKey: keys.accountPublicKey,
    accountPrivateKey: keys.accountPrivateKey,
    oldPrivateKeys: [],
  }
}

function server(
  stored: StoredAccountKeys | null,
  overrides: Partial<ServerKeyStatus> = {}
): ServerKeyStatus {
  return {
    hasKeys: true,
    identifier: 'alex@example.com',
    accountPublicKey: stored ? base64urlEncode(stored.accountPublicKey) : null,
    ...overrides,
  }
}

describe('account key state machine', () => {
  const alex = storedKeys('alex')

  it('starts in loading', () => {
    expect(INITIAL_ACCOUNT_KEY_STATE).toEqual({ status: 'loading' })
  })

  it('is signed out and clears the store when the session ends, from every state', () => {
    const states: AccountKeyState[] = [
      { status: 'loading' },
      { status: 'signed-out' },
      { status: 'setup-required', userId: 'alex', identifier: 'a@b.c' },
      {
        status: 'locked',
        userId: 'alex',
        identifier: 'a@b.c',
        accountPublicKey: 'k',
      },
      {
        status: 'unlocked',
        userId: 'alex',
        identifier: 'a@b.c',
        accountPublicKey: 'k',
        keys: alex,
      },
    ]
    for (const state of states)
      expect(transitionAccountKeys(state, { type: 'session-ended' })).toEqual({
        state: { status: 'signed-out' },
        effect: { type: 'clear' },
      })
  })

  it('requires setup for an account without keys, and drops keys that the store still holds', () => {
    const event = {
      type: 'session-resolved' as const,
      userId: 'alex',
      server: { hasKeys: false, identifier: 'a@b.c', accountPublicKey: null },
    }
    expect(
      transitionAccountKeys(INITIAL_ACCOUNT_KEY_STATE, {
        ...event,
        stored: null,
      })
    ).toEqual({
      state: { status: 'setup-required', userId: 'alex', identifier: 'a@b.c' },
      effect: { type: 'none' },
    })
    expect(
      transitionAccountKeys(INITIAL_ACCOUNT_KEY_STATE, {
        ...event,
        stored: alex,
      }).effect
    ).toEqual({ type: 'clear' })
  })

  it('is locked when the server has keys and this browser has none', () => {
    const result = transitionAccountKeys(INITIAL_ACCOUNT_KEY_STATE, {
      type: 'session-resolved',
      userId: 'alex',
      server: server(alex),
      stored: null,
    })
    expect(result.state).toEqual({
      status: 'locked',
      userId: 'alex',
      identifier: 'alex@example.com',
      accountPublicKey: base64urlEncode(alex.accountPublicKey),
    })
    expect(result.effect).toEqual({ type: 'none' })
  })

  it('is unlocked when the store holds the keys of this user and this account record', () => {
    const result = transitionAccountKeys(INITIAL_ACCOUNT_KEY_STATE, {
      type: 'session-resolved',
      userId: 'alex',
      server: server(alex),
      stored: alex,
    })
    expect(result.state.status).toBe('unlocked')
    expect(result.state).toMatchObject({ userId: 'alex', keys: alex })
    expect(result.effect).toEqual({ type: 'none' })
  })

  it('clears the keys of a different user and is locked', () => {
    const result = transitionAccountKeys(INITIAL_ACCOUNT_KEY_STATE, {
      type: 'session-resolved',
      userId: 'blake',
      server: server(storedKeys('blake', 2)),
      stored: alex,
    })
    expect(result.state.status).toBe('locked')
    expect(result.effect).toEqual({ type: 'clear' })
  })

  it('clears keys of the same user id that belong to a different account record', () => {
    // The same user id with a different key: the account was rotated or
    // reset on another device.
    const result = transitionAccountKeys(
      {
        status: 'unlocked',
        userId: 'alex',
        identifier: 'alex@example.com',
        accountPublicKey: base64urlEncode(alex.accountPublicKey),
        keys: alex,
      },
      {
        type: 'session-resolved',
        userId: 'alex',
        server: server(storedKeys('alex', 7)),
        stored: alex,
      }
    )
    expect(result.state.status).toBe('locked')
    expect(result.effect).toEqual({ type: 'clear' })
  })

  it('accepts unlocked keys only for the account that the session is for', () => {
    const locked = transitionAccountKeys(INITIAL_ACCOUNT_KEY_STATE, {
      type: 'session-resolved',
      userId: 'alex',
      server: server(alex),
      stored: null,
    }).state
    const unlocked = transitionAccountKeys(locked, {
      type: 'keys-unlocked',
      keys: alex,
    })
    expect(unlocked.state.status).toBe('unlocked')
    expect(unlocked.effect).toEqual({ type: 'save', keys: alex })

    // A different user id.
    expect(
      transitionAccountKeys(locked, {
        type: 'keys-unlocked',
        keys: { ...alex, userId: 'blake' },
      })
    ).toEqual({ state: locked, effect: { type: 'none' } })
    // The right user id with a key of a different account record.
    expect(
      transitionAccountKeys(locked, {
        type: 'keys-unlocked',
        keys: storedKeys('alex', 9),
      })
    ).toEqual({ state: locked, effect: { type: 'none' } })
    // No resolved session: nothing is stored.
    for (const state of [
      { status: 'loading' },
      { status: 'signed-out' },
      { status: 'setup-required', userId: 'alex', identifier: 'a@b.c' },
    ] as AccountKeyState[])
      expect(
        transitionAccountKeys(state, { type: 'keys-unlocked', keys: alex })
      ).toEqual({ state, effect: { type: 'none' } })
  })

  it('locks and clears the store when the keys are dropped', () => {
    const unlocked = transitionAccountKeys(
      transitionAccountKeys(INITIAL_ACCOUNT_KEY_STATE, {
        type: 'session-resolved',
        userId: 'alex',
        server: server(alex),
        stored: alex,
      }).state,
      { type: 'keys-dropped' }
    )
    expect(unlocked.state.status).toBe('locked')
    expect(unlocked.effect).toEqual({ type: 'clear' })
    expect(
      transitionAccountKeys({ status: 'signed-out' }, { type: 'keys-dropped' })
    ).toEqual({ state: { status: 'signed-out' }, effect: { type: 'clear' } })
  })

  it('storedKeysMatch needs the user id and the public key', () => {
    const key = base64urlEncode(alex.accountPublicKey)
    expect(storedKeysMatch(alex, 'alex', key)).toBe(true)
    expect(storedKeysMatch(alex, 'blake', key)).toBe(false)
    expect(storedKeysMatch(alex, 'alex', null)).toBe(false)
    expect(storedKeysMatch(null, 'alex', key)).toBe(false)
  })

  it('drives a store through sign-in, a user change and sign-out', async () => {
    const store = createMemoryKeyStore()
    let state = INITIAL_ACCOUNT_KEY_STATE
    async function send(event: Parameters<typeof transitionAccountKeys>[1]) {
      const next = transitionAccountKeys(state, event)
      state = next.state
      if (next.effect.type === 'clear') await store.clear()
      if (next.effect.type === 'save') await store.save(next.effect.keys)
    }
    await send({
      type: 'session-resolved',
      userId: 'alex',
      server: server(alex),
      stored: await store.load(),
    })
    await send({ type: 'keys-unlocked', keys: alex })
    expect((await store.load())?.userId).toBe('alex')

    const blake = storedKeys('blake', 2)
    await send({
      type: 'session-resolved',
      userId: 'blake',
      server: server(blake),
      stored: await store.load(),
    })
    expect(state.status).toBe('locked')
    expect(await store.load()).toBeNull()

    await send({ type: 'keys-unlocked', keys: blake })
    await send({ type: 'session-ended' })
    expect(state.status).toBe('signed-out')
    expect(await store.load()).toBeNull()
  })
})

describe('key store', () => {
  function contract(name: string, make: () => KeyStore) {
    it(`${name}: is empty, saves, loads, replaces and clears`, async () => {
      const store = make()
      expect(await store.load()).toBeNull()
      const first = { ...storedKeys('alex'), oldPrivateKeys: [randomBytes(32)] }
      await store.save(first)
      expect(await store.load()).toEqual(first)
      const second = storedKeys('blake', 2)
      await store.save(second)
      expect(await store.load()).toEqual(second)
      await store.clear()
      expect(await store.load()).toBeNull()
      await store.clear()
    })
  }
  contract('memory', createMemoryKeyStore)

  it('memory: keeps its own copy and erases it', async () => {
    const store = createMemoryKeyStore()
    const keys = storedKeys('alex')
    const original = keys.accountPrivateKey.slice()
    await store.save(keys)
    keys.accountPrivateKey.fill(0)
    const loaded = (await store.load())!
    expect(loaded.accountPrivateKey).toEqual(original)
    // A loaded copy is the caller's: changing it does not change the store.
    loaded.accountPrivateKey.fill(0)
    expect((await store.load())!.accountPrivateKey).toEqual(original)
  })

  it('reads only a complete record, and has no field for other secrets', () => {
    const keys = storedKeys('alex')
    expect(readStoredAccountKeys(keys)).toEqual(keys)
    expect(
      Object.keys(
        readStoredAccountKeys({
          ...keys,
          passphrase: 'x',
          wrapKey: new Uint8Array(32),
          rootEntropy: new Uint8Array(32),
        })!
      ).sort()
    ).toEqual([
      'accountPrivateKey',
      'accountPublicKey',
      'oldPrivateKeys',
      'userId',
    ])
    for (const broken of [
      null,
      undefined,
      'text',
      {},
      { ...keys, userId: '' },
      { ...keys, userId: 5 },
      { ...keys, accountPrivateKey: new Uint8Array(31) },
      { ...keys, accountPublicKey: [1, 2, 3] },
      { ...keys, oldPrivateKeys: [new Uint8Array(5)] },
      { ...keys, oldPrivateKeys: null },
    ])
      expect(readStoredAccountKeys(broken)).toBeNull()
  })
})

describe('client procedures', () => {
  it('makes an account record that the server schema accepts and that its own keys open', async () => {
    const { argon2id, calls } = fakeArgon2id()
    const account = await createNewAccount({
      passphrase: 'a long passphrase',
      argon2id,
    })
    expect(calls).toHaveLength(1)
    const wire = accountRecordToWire(account.record)
    const parsed = accountRecordSchema.parse(wire)
    expect(parsed.accountPublicKey).toEqual(
      account.accountKeys.accountPublicKey
    )
    expect(Object.keys(wire).sort()).toEqual([
      'accountPublicKey',
      'authPublicKey',
      'passphraseSalt',
      'protocolVersion',
      'wrappedRoot',
    ])
    // The stored form: one version byte, then the 88-byte record.
    expect(base64urlDecode(wire.wrappedRoot)).toHaveLength(89)
    expect(base64urlDecode(wire.wrappedRoot)[0]).toBe(0x01)

    const opened = openAccount({
      passphraseKeys: account.passphraseKeys,
      accountPublicKey: account.record.accountPublicKey,
      wrappedRoot: wrappedRootFromWire(wire.wrappedRoot),
      sealedKeyring: null,
    })
    expect(opened.accountKeys.accountPrivateKey).toEqual(
      account.accountKeys.accountPrivateKey
    )
    expect(opened.oldPrivateKeys).toEqual([])
    expect(mnemonicFromRootEntropy(opened.rootEntropy)).toBe(account.mnemonic)
    expect(account.mnemonic.split(' ')).toHaveLength(24)

    // The same passphrase and salt give the same sign-in key: no second
    // Argon2id is needed to sign in directly after account creation.
    const again = await derivePassphraseKeys({
      passphrase: 'a long passphrase',
      passphraseSalt: account.record.passphraseSalt,
      argon2id,
    })
    expect(again.authPrivateKey).toEqual(account.passphraseKeys.authPrivateKey)

    wipePassphraseKeys(account.passphraseKeys)
    expect(isAllZero(account.passphraseKeys.authPrivateKey)).toBe(true)
    expect(isAllZero(account.passphraseKeys.wrapKey)).toBe(true)
  })

  it('does not open an account with the keys of a different passphrase', async () => {
    const { argon2id } = fakeArgon2id()
    const account = await createNewAccount({ passphrase: 'right', argon2id })
    const wrong = await derivePassphraseKeys({
      passphrase: 'wrong',
      passphraseSalt: account.record.passphraseSalt,
      argon2id,
    })
    expectReason(
      () =>
        openAccount({
          passphraseKeys: wrong,
          accountPublicKey: account.record.accountPublicKey,
          wrappedRoot: account.record.wrappedRoot,
          sealedKeyring: null,
        }),
      'tag_mismatch'
    )
  })

  it('checks a mnemonic against the account public key', async () => {
    const { argon2id } = fakeArgon2id()
    const account = await createNewAccount({ passphrase: 'p', argon2id })
    const keys = accountKeysFromMnemonic(
      `  ${account.mnemonic.toUpperCase().replace(/ /g, '   ')} `,
      account.record.accountPublicKey
    )
    expect(keys.accountPrivateKey).toEqual(
      account.accountKeys.accountPrivateKey
    )
    const other = mnemonicFromRootEntropy(generateRootEntropy())
    expectReason(
      () => accountKeysFromMnemonic(other, account.record.accountPublicKey),
      'key_mismatch'
    )
    expectReason(
      () =>
        accountKeysFromMnemonic(
          'not a recovery phrase',
          account.record.accountPublicKey
        ),
      'invalid_mnemonic'
    )
  })

  it('rotates to new keys and keeps every old key in the keyring, newest first', async () => {
    const { argon2id } = fakeArgon2id()
    const first = await createNewAccount({ passphrase: 'one', argon2id })
    const second = await createRotation({
      newPassphrase: 'two',
      argon2id,
      oldAccountPrivateKey: first.accountKeys.accountPrivateKey,
      oldKeyring: [],
    })
    expect(second.record.accountPublicKey).not.toEqual(
      first.record.accountPublicKey
    )
    expect(second.record.passphraseSalt).not.toEqual(
      first.record.passphraseSalt
    )
    expect(second.record.authPublicKey).not.toEqual(first.record.authPublicKey)
    expect(second.mnemonic).not.toBe(first.mnemonic)

    const wire = sealedKeyringToWire(second.sealedKeyring)!
    expect(base64urlDecode(wire)[0]).toBe(0x01)
    const afterSecond = openAccount({
      passphraseKeys: second.passphraseKeys,
      accountPublicKey: second.record.accountPublicKey,
      wrappedRoot: second.record.wrappedRoot,
      sealedKeyring: sealedKeyringFromWire(wire),
    })
    expect(afterSecond.oldPrivateKeys).toEqual([
      first.accountKeys.accountPrivateKey,
    ])

    const third = await createRotation({
      newPassphrase: 'three',
      argon2id,
      oldAccountPrivateKey: second.accountKeys.accountPrivateKey,
      oldKeyring: afterSecond.oldPrivateKeys,
    })
    expect(
      openKeyring({
        accountPrivateKey: third.accountKeys.accountPrivateKey,
        accountPublicKey: third.accountKeys.accountPublicKey,
        sealedKeyring: third.sealedKeyring,
      })
    ).toEqual([
      second.accountKeys.accountPrivateKey,
      first.accountKeys.accountPrivateKey,
    ])
    // The old passphrase keys do not open the new record.
    expectReason(
      () =>
        unwrapRoot({
          wrapKey: first.passphraseKeys.wrapKey,
          accountPublicKey: third.record.accountPublicKey,
          wrappedRoot: third.record.wrappedRoot,
        }),
      'tag_mismatch'
    )
  })

  it('refuses a keyring that the server would refuse, before the slow step', async () => {
    const { argon2id, calls } = fakeArgon2id()
    const keys = Array.from(
      { length: MAX_KEYRING_KEYS },
      () => randomBytes(32) as AccountPrivateKey
    )
    await expectReasonAsync(
      () =>
        createRotation({
          newPassphrase: 'p',
          argon2id,
          oldAccountPrivateKey: randomBytes(32) as AccountPrivateKey,
          oldKeyring: keys,
        }),
      'invalid_argument'
    )
    expect(calls).toHaveLength(0)
  })

  it('wire helpers pass null keyrings through and stop at an unknown protocol version', () => {
    expect(sealedKeyringToWire(null)).toBeNull()
    expect(sealedKeyringFromWire(null)).toBeNull()
    expect(sealedKeyringFromWire(undefined)).toBeNull()
    expect(() => assertKnownProtocolVersion(1)).not.toThrow()
    for (const version of [0, 2, '1', null, undefined])
      expectReason(() => assertKnownProtocolVersion(version), 'unknown_version')
  })
})

describe('signed request of the client', () => {
  const keys = accountKeysFromPrivateKey(
    new Uint8Array(32).fill(5) as AccountPrivateKey
  )
  const challenge = base64urlEncode(new Uint8Array(32).fill(8))

  function verify(
    request: ReturnType<typeof buildSignedRequest>,
    overrides: Partial<{
      method: string
      path: string
      body: string
      accountPublicKey: AccountPublicKey
    }> = {}
  ) {
    // The checks of `lib/auth/e2ee/signed-request.ts`: the two headers in
    // base64url, the method and the path of the request, the body bytes.
    const headers = new Headers(request.headers)
    return verifySignedRequest({
      accountPublicKey: overrides.accountPublicKey ?? keys.accountPublicKey,
      challenge: base64urlDecode(
        headers.get('x-flare-e2ee-challenge')!
      ) as Challenge,
      method: overrides.method ?? request.method,
      path: overrides.path ?? request.path,
      body: utf8(overrides.body ?? request.body),
      signature: base64urlDecode(headers.get('x-flare-e2ee-signature')!),
    })
  }

  it('uses the header names that the server reads', () => {
    expect(SIGNED_REQUEST_CHALLENGE_HEADER.toLowerCase()).toBe(
      'x-flare-e2ee-challenge'
    )
    expect(SIGNED_REQUEST_SIGNATURE_HEADER.toLowerCase()).toBe(
      'x-flare-e2ee-signature'
    )
  })

  it('signs the method, the path and the exact body that it returns', () => {
    const request = buildSignedRequest({
      accountPrivateKey: keys.accountPrivateKey,
      challenge,
      method: 'post',
      path: '/api/auth/e2ee/rotation',
      body: { sealedKeyring: null, name: 'é' },
    })
    expect(request.method).toBe('POST')
    expect(request.body).toBe('{"sealedKeyring":null,"name":"é"}')
    expect(request.headers['Content-Type']).toBe('application/json')
    expect(request.headers[SIGNED_REQUEST_CHALLENGE_HEADER]).toBe(challenge)
    expect(verify(request)).toBe(true)
    expect(verify(request, { method: 'PUT' })).toBe(false)
    expect(verify(request, { path: '/api/auth/e2ee/keyring' })).toBe(false)
    expect(verify(request, { path: '/api/auth/e2ee/rotation?x=1' })).toBe(false)
    expect(
      verify(request, { body: '{"sealedKeyring":null, "name":"é"}' })
    ).toBe(false)
    expect(
      verify(request, {
        accountPublicKey: accountKeysFromPrivateKey(
          new Uint8Array(32).fill(6) as AccountPrivateKey
        ).accountPublicKey,
      })
    ).toBe(false)
  })

  it('refuses a challenge that is not 32 bytes', () => {
    expect(() =>
      buildSignedRequest({
        accountPrivateKey: keys.accountPrivateKey,
        challenge: base64urlEncode(new Uint8Array(16)),
        method: 'POST',
        path: '/x',
        body: {},
      })
    ).toThrow()
  })
})

describe('passphrase strength check', () => {
  it('rejects weak secrets and accepts a passphrase of unrelated words', async () => {
    const { MINIMUM_STRENGTH_SCORE, measurePassphrase } =
      await import('@/lib/e2ee/client/strength')
    expect(MINIMUM_STRENGTH_SCORE).toBe(3)
    for (const weak of [
      'password',
      'qwerty12345',
      'letmein2024',
      'aaaaaaaaaaaa',
    ])
      expect((await measurePassphrase(weak)).acceptable).toBe(false)
    const strong = await measurePassphrase('granite walrus opera lantern 58')
    expect(strong.acceptable).toBe(true)
    expect(strong.score).toBeGreaterThanOrEqual(3)
  }, 30_000)

  it('scores a secret lower when it is made of the identifier, the username or the instance name', async () => {
    const { measurePassphrase } = await import('@/lib/e2ee/client/strength')
    const inputs = [
      'marguerite.delacroix@skyvault.example',
      'Marguerite',
      'Skyvault',
    ]
    // The address is split at `@` and `.`, so its parts count too.
    const secret = 'skyvault.delacroix'
    const alone = await measurePassphrase(secret)
    const withInputs = await measurePassphrase(secret, inputs)
    expect(withInputs.score).toBeLessThan(alone.score)
    // The address itself is long, and worthless as its own passphrase.
    expect((await measurePassphrase(inputs[0])).acceptable).toBe(true)
    expect((await measurePassphrase(inputs[0], inputs)).acceptable).toBe(false)
    expect(
      (await measurePassphrase('SkyvaultMarguerite', inputs)).acceptable
    ).toBe(false)
  }, 30_000)
})
