import { describe, expect, it } from 'vitest'

import {
  derivePassphraseKeys,
  openKeyring,
  rootEntropyFromMnemonic,
  unlockAccount,
} from '@/lib/e2ee/account'
import { contentContext, decryptFile, headerHash } from '@/lib/e2ee/file'
import { bytesToHex } from '@/lib/e2ee/primitives'
import {
  createRandomAccount,
  createRandomFile,
  createRandomFolder,
  encryptFileWithRandomNoncePrefix,
  generateFileKey,
  generateSealNonce,
  randomBytes,
  sealFileMetadataWithRandomNonce,
  sealKeyringWithRandomNonce,
  sealOcrTextWithRandomNonce,
  sealTagMetadataWithRandomNonce,
  sealThumbnailWithRandomNonce,
  wrapAccountStanzaWithRandomKey,
  wrapFolderFileStanzaWithRandomKey,
  wrapFolderLinkSecretStanzaWithRandomKey,
  wrapRandomPasswordStanza,
  wrapRootWithRandomNonce,
} from '@/lib/e2ee/random'
import {
  openFileMetadata,
  openFolderMetadata,
  openFolderPrivateKey,
  openOcrText,
  openTagMetadata,
  openThumbnail,
} from '@/lib/e2ee/records'
import {
  openSealedLinkSecret,
  unwrapAccountStanza,
  unwrapFolderFileStanza,
  unwrapFolderLinkSecretStanza,
  unwrapParentFolderStanza,
  unwrapPasswordStanza,
} from '@/lib/e2ee/stanza'
import { asWrapKey } from '@/lib/e2ee/types'

import { collect, fakeArgon2id, mod251, pattern } from './test-support'

describe('random wrappers', () => {
  it('draws the requested number of bytes, also above 65536', () => {
    expect(randomBytes(0)).toHaveLength(0)
    expect(randomBytes(32)).toHaveLength(32)
    const large = randomBytes(70000)
    expect(large).toHaveLength(70000)
    expect(large.subarray(65536).some((byte) => byte !== 0)).toBe(true)
    expect(bytesToHex(generateFileKey())).not.toBe(
      bytesToHex(generateFileKey())
    )
    expect(generateSealNonce()).toHaveLength(24)
  })

  it('creates an account, a file and its records that open again', async () => {
    const { argon2id } = fakeArgon2id()
    const { record, accountKeys, mnemonic } = await createRandomAccount({
      passphrase: 'correct horse battery staple',
      argon2id,
    })
    const passphraseKeys = await derivePassphraseKeys({
      passphrase: 'correct horse battery staple',
      passphraseSalt: record.passphraseSalt,
      argon2id,
    })
    const unlockInput = {
      wrapKey: passphraseKeys.wrapKey,
      accountPublicKey: record.accountPublicKey,
      wrappedRoot: record.wrappedRoot,
    }
    expect(unlockAccount(unlockInput)).toEqual(accountKeys)
    const rewrapped = wrapRootWithRandomNonce({
      wrapKey: asWrapKey(pattern(32)),
      accountPublicKey: record.accountPublicKey,
      rootEntropy: rootEntropyFromMnemonic(mnemonic),
    })
    expect(rewrapped).toHaveLength(88)

    const sealedKeyring = sealKeyringWithRandomNonce({
      ...accountKeys,
      oldPrivateKeys: [accountKeys.accountPrivateKey],
    })
    expect(openKeyring({ ...accountKeys, sealedKeyring })).toEqual([
      accountKeys.accountPrivateKey,
    ])

    const { fileKey, header } = createRandomFile()
    const hash = headerHash(header)
    expect(contentContext(fileKey, header).headerHash).toEqual(hash)
    const stored = await collect(
      encryptFileWithRandomNoncePrefix(fileKey, [mod251(70000)])
    )
    expect(await collect(decryptFile(fileKey, [stored]))).toEqual(mod251(70000))

    const stanza = wrapAccountStanzaWithRandomKey({
      accountPublicKey: accountKeys.accountPublicKey,
      headerHash: hash,
      fileKey,
    })
    expect(
      unwrapAccountStanza({
        accountPrivateKey: accountKeys.accountPrivateKey,
        headerHash: hash,
        stanza,
      })
    ).toEqual(fileKey)
    expect(
      wrapAccountStanzaWithRandomKey({
        accountPublicKey: accountKeys.accountPublicKey,
        headerHash: hash,
        fileKey,
      })
    ).not.toEqual(stanza)

    const base = { fileKey, headerHash: hash }
    expect(
      openFileMetadata({
        ...base,
        sealedMetadata: sealFileMetadataWithRandomNonce({
          ...base,
          metadata: { name: 'a.txt', type: 'text/plain' },
        }),
      })
    ).toEqual({ name: 'a.txt', type: 'text/plain' })
    expect(
      openOcrText({
        ...base,
        sealedOcrText: sealOcrTextWithRandomNonce({ ...base, ocrText: 'text' }),
      })
    ).toBe('text')
    expect(
      openThumbnail({
        ...base,
        sealedThumbnail: sealThumbnailWithRandomNonce({
          ...base,
          thumbnail: pattern(99),
        }),
      })
    ).toEqual(pattern(99))
    expect(
      openTagMetadata({
        ...accountKeys,
        sealedTagMetadata: sealTagMetadataWithRandomNonce({
          ...accountKeys,
          metadata: { name: 'Work' },
        }),
      })
    ).toEqual({ name: 'Work' })

    const password = await wrapRandomPasswordStanza({
      ...base,
      password: 'correct horse',
      ownerPublicKey: accountKeys.accountPublicKey,
      argon2id,
    })
    expect(
      await unwrapPasswordStanza({
        password: 'correct horse',
        linkSecret: password.linkSecret,
        headerHash: hash,
        stanza: password.stanza,
        argon2id,
      })
    ).toEqual(fileKey)
    expect(openSealedLinkSecret({ ...base, stanza: password.stanza })).toEqual(
      password.linkSecret
    )

    const parent = createRandomFolder({
      accountKeys,
      metadata: { name: 'Parent' },
    })
    expect(parent.parentFolderStanza).toBeUndefined()
    const child = createRandomFolder({
      accountKeys,
      metadata: { name: 'Child' },
      parentFolderPublicKey: parent.folderPublicKey,
    })
    expect(
      openFolderPrivateKey({
        accountPrivateKey: accountKeys.accountPrivateKey,
        folderPublicKey: child.folderPublicKey,
        sealedFolderPrivateKey: child.sealedFolderPrivateKey,
      }).folderPrivateKey
    ).toEqual(child.folderPrivateKey)
    const childKey = unwrapParentFolderStanza({
      parentFolderPrivateKey: parent.folderPrivateKey,
      folderPublicKey: child.folderPublicKey,
      stanza: child.parentFolderStanza as Uint8Array,
    })
    expect(
      openFolderMetadata({
        folderPrivateKey: childKey,
        sealedFolderMetadata: child.sealedFolderMetadata,
      })
    ).toEqual({ name: 'Child' })
    expect(
      unwrapFolderFileStanza({
        folderPrivateKey: childKey,
        headerHash: hash,
        stanza: wrapFolderFileStanzaWithRandomKey({
          folderPublicKey: child.folderPublicKey,
          headerHash: hash,
          fileKey,
        }),
      })
    ).toEqual(fileKey)
    expect(
      unwrapFolderLinkSecretStanza({
        folderPrivateKey: childKey,
        headerHash: hash,
        stanza: wrapFolderLinkSecretStanzaWithRandomKey({
          folderPublicKey: child.folderPublicKey,
          headerHash: hash,
          linkSecret: password.linkSecret,
        }),
      })
    ).toEqual(password.linkSecret)
  })
})
