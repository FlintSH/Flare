import { describe, expect, it } from 'vitest'

import {
  accountKeysFromPrivateKey,
  base64urlDecode,
  base64urlEncode,
  bytesToHex,
  decodeStoredRecord,
  ed2curvePrivate,
  generateFileKey,
  headerHash,
  isE2eeError,
  unwrapAccountStanza,
  unwrapAccountStanzaWithSharedSecret,
  x25519PublicKey,
  x25519SharedSecret,
} from '@/lib/e2ee'
import type { Argon2id } from '@/lib/e2ee'
import {
  createAccountUnwrapper,
  newEncryptedFile,
  newPasswordStanza,
  openWithFileKey,
  openWithPassword,
  shareSecretOf,
} from '@/lib/e2ee/client/files'
import { importNativeX25519 } from '@/lib/e2ee/client/native-x25519'
import type {
  AccountPrivateKey,
  EphemeralPublicKey,
  ExchangePublicKey,
} from '@/lib/e2ee/types'

const seed = (fill: number) =>
  Uint8Array.from(
    { length: 32 },
    (_, i) => (i * 7 + fill) & 0xff
  ) as AccountPrivateKey
const account = accountKeysFromPrivateKey(seed(3))
const older = accountKeysFromPrivateKey(seed(91))

/** A cheap stand-in: the stretch itself has its own vectors. */
const fakeArgon2id: Argon2id = async (input) =>
  Uint8Array.from(
    { length: 32 },
    (_, i) => input.password[i % input.password.length] ^ input.salt[i]
  )

function upload(publicKey = account.accountPublicKey) {
  return newEncryptedFile({
    name: 'holiday photo.png',
    type: 'image/png',
    accountPublicKey: publicKey,
  })
}

describe('X25519 of the browser against the library (section 9.8.3)', () => {
  it('has WebCrypto X25519 in this runtime, so the comparison is real', async () => {
    const exchange = ed2curvePrivate(account.accountPrivateKey)
    expect(await importNativeX25519(exchange)).not.toBeNull()
  })

  it('gives the same shared secret as the library for many key pairs', async () => {
    for (let round = 0; round < 24; round++) {
      const exchange = ed2curvePrivate(seed(round))
      const peer = x25519PublicKey<'ephemeral_public_key'>(
        ed2curvePrivate(seed(200 - round))
      ) as EphemeralPublicKey
      const native = await importNativeX25519(exchange)
      const shared = await native!.sharedSecret(peer)
      expect(bytesToHex(shared!)).toBe(
        bytesToHex(x25519SharedSecret(exchange, peer))
      )
    }
  })

  it('opens the same file_key from an account stanza both ways', async () => {
    for (let round = 0; round < 8; round++) {
      const created = upload()
      const native = await createAccountUnwrapper({
        accountPrivateKey: account.accountPrivateKey,
        oldPrivateKeys: [],
      })
      const library = await createAccountUnwrapper(
        { accountPrivateKey: account.accountPrivateKey, oldPrivateKeys: [] },
        { useNative: false }
      )
      const a = await native.unwrap(created.records)
      const b = await library.unwrap(created.records)
      expect(bytesToHex(a.fileKey)).toBe(bytesToHex(created.fileKey))
      expect(bytesToHex(b.fileKey)).toBe(bytesToHex(created.fileKey))
      expect(a.name).toBe('holiday photo.png')
      expect(a.type).toBe('image/png')
      // And both agree with the plain library procedure.
      const direct = unwrapAccountStanza({
        accountPrivateKey: account.accountPrivateKey,
        headerHash: created.headerHash,
        stanza: decodeStoredRecord(
          'account_stanza',
          base64urlDecode(created.records.accountStanza)
        ),
      })
      expect(bytesToHex(direct)).toBe(bytesToHex(created.fileKey))
    }
  })

  it('refuses a small-order ephemeral key natively, as the library does', async () => {
    const native = await importNativeX25519(
      ed2curvePrivate(account.accountPrivateKey)
    )
    expect(await native!.sharedSecret(new Uint8Array(32))).toBeNull()
    const one = new Uint8Array(32)
    one[0] = 1
    expect(await native!.sharedSecret(one)).toBeNull()
  })
})

describe('unwrapAccountStanzaWithSharedSecret (section 8.1, steps 1, 2 and 4)', () => {
  const created = upload()
  const stanza = decodeStoredRecord(
    'account_stanza',
    base64urlDecode(created.records.accountStanza)
  )
  const exchangePrivateKey = ed2curvePrivate(account.accountPrivateKey)
  const exchangePublicKey = x25519PublicKey<'exchange_public_key'>(
    exchangePrivateKey
  ) as ExchangePublicKey
  const sharedSecret = x25519SharedSecret(
    exchangePrivateKey,
    stanza.subarray(0, 32) as EphemeralPublicKey
  )
  const input = {
    sharedSecret,
    exchangePublicKey,
    headerHash: created.headerHash,
    stanza,
  }
  const reason = (run: () => unknown) => {
    try {
      run()
    } catch (error) {
      return isE2eeError(error) ? error.reason : 'not an E2eeError'
    }
    return 'no error'
  }

  it('gives the file_key', () => {
    expect(bytesToHex(unwrapAccountStanzaWithSharedSecret(input))).toBe(
      bytesToHex(created.fileKey)
    )
  })

  it('rejects an all-zero shared secret', () => {
    expect(
      reason(() =>
        unwrapAccountStanzaWithSharedSecret({
          ...input,
          sharedSecret: new Uint8Array(32),
        })
      )
    ).toBe('low_order_point')
  })

  it('rejects a stanza of the wrong length and an ephemeral key that is not canonical', () => {
    expect(
      reason(() =>
        unwrapAccountStanzaWithSharedSecret({
          ...input,
          stanza: stanza.subarray(0, 95),
        })
      )
    ).toBe('bad_length')
    const changed = stanza.slice()
    changed.fill(0xff, 0, 32)
    expect(
      reason(() =>
        unwrapAccountStanzaWithSharedSecret({ ...input, stanza: changed })
      )
    ).toBe('non_canonical_public_key')
  })

  it('fails with tag_mismatch for a wrong secret, a wrong recipient key or a different file', () => {
    const wrong = sharedSecret.slice()
    wrong[0] ^= 1
    expect(
      reason(() =>
        unwrapAccountStanzaWithSharedSecret({ ...input, sharedSecret: wrong })
      )
    ).toBe('tag_mismatch')
    expect(
      reason(() =>
        unwrapAccountStanzaWithSharedSecret({
          ...input,
          exchangePublicKey: x25519PublicKey<'exchange_public_key'>(
            ed2curvePrivate(older.accountPrivateKey)
          ) as ExchangePublicKey,
        })
      )
    ).toBe('tag_mismatch')
    expect(
      reason(() =>
        unwrapAccountStanzaWithSharedSecret({
          ...input,
          headerHash: headerHash(upload().header),
        })
      )
    ).toBe('tag_mismatch')
  })
})

describe('records of a file in the browser', () => {
  it('opens a stanza made for an old key of the keyring (section 8.3.4)', async () => {
    const created = upload(older.accountPublicKey)
    const unwrapper = await createAccountUnwrapper({
      accountPrivateKey: account.accountPrivateKey,
      oldPrivateKeys: [older.accountPrivateKey],
    })
    expect((await unwrapper.unwrap(created.records)).name).toBe(
      'holiday photo.png'
    )
    const current = await createAccountUnwrapper({
      accountPrivateKey: account.accountPrivateKey,
      oldPrivateKeys: [],
    })
    await expect(current.unwrap(created.records)).rejects.toMatchObject({
      reason: 'tag_mismatch',
    })
  })

  it('rejects the key of a different file with tag_mismatch', () => {
    const created = upload()
    expect(openWithFileKey(created.records, created.fileKey).name).toBe(
      'holiday photo.png'
    )
    expect(() => openWithFileKey(created.records, generateFileKey())).toThrow(
      expect.objectContaining({ reason: 'tag_mismatch' })
    )
  })

  it('never puts the name, the type or the key in the records it sends', () => {
    const created = upload()
    const sent = JSON.stringify(created.records)
    expect(sent).not.toContain('holiday')
    expect(sent).not.toContain('image/png')
    expect(sent).not.toContain(base64urlEncode(created.fileKey))
    // Each stored record starts with record_version 0x01 (section 4.4, rule 12).
    expect(base64urlDecode(created.records.sealedMetadata)[0]).toBe(1)
    expect(base64urlDecode(created.records.accountStanza)).toHaveLength(97)
    expect(base64urlDecode(created.records.accountStanza)[0]).toBe(1)
    expect(base64urlDecode(created.records.header)).toHaveLength(26)
  })

  it('makes a password stanza whose link secret the owner reads back, and a new one for a new password', async () => {
    const created = upload()
    const first = await newPasswordStanza({
      opened: created,
      password: 'harbor violet canyon',
      ownerPublicKey: account.accountPublicKey,
      argon2id: fakeArgon2id,
    })
    expect(base64urlDecode(first.passwordStanza)).toHaveLength(217)
    const opened = openWithFileKey(created.records, created.fileKey)
    const secret = shareSecretOf(opened, first.passwordStanza)
    expect(secret).toEqual(first.secret)
    expect(shareSecretOf(opened, null)).toEqual({
      kind: 'file_key',
      fileKey: created.fileKey,
    })
    if (first.secret.kind !== 'link_secret') throw new Error('unreachable')
    const records = { ...created.records, passwordStanza: first.passwordStanza }
    const visitor = await openWithPassword({
      records,
      linkSecret: first.secret.linkSecret,
      password: 'harbor violet canyon',
      argon2id: fakeArgon2id,
    })
    expect(bytesToHex(visitor.fileKey)).toBe(bytesToHex(created.fileKey))
    await expect(
      openWithPassword({
        records,
        linkSecret: first.secret.linkSecret,
        password: 'harbor violet canyoN',
        argon2id: fakeArgon2id,
      })
    ).rejects.toMatchObject({ reason: 'tag_mismatch' })

    // A changed password: the old link's secret opens nothing.
    const second = await newPasswordStanza({
      opened: created,
      password: 'meadow signal amber',
      ownerPublicKey: account.accountPublicKey,
      argon2id: fakeArgon2id,
    })
    if (second.secret.kind !== 'link_secret') throw new Error('unreachable')
    expect(bytesToHex(second.secret.linkSecret)).not.toBe(
      bytesToHex(first.secret.linkSecret)
    )
    for (const password of ['harbor violet canyon', 'meadow signal amber'])
      await expect(
        openWithPassword({
          records: {
            ...created.records,
            passwordStanza: second.passwordStanza,
          },
          linkSecret: first.secret.linkSecret,
          password,
          argon2id: fakeArgon2id,
        })
      ).rejects.toMatchObject({ reason: 'tag_mismatch' })
  })
})
