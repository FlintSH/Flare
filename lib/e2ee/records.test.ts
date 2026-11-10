import { describe, expect, it } from 'vitest'

import { deriveAccountKeys } from './account'
import { CONTEXTS } from './contexts'
import { deriveFileKeys } from './file'
import {
  blake3DeriveKey,
  bytesToHex,
  utf8,
  x25519PublicKey,
} from './primitives'
import {
  decodeJsonObject,
  decodeRecord,
  deriveFolderMetadataKey,
  deriveFolderOwnerKey,
  deriveTagKey,
  encodeJsonObject,
  encodeRecord,
  folderPublicKeyOf,
  openFileMetadata,
  openFolderMetadata,
  openFolderPrivateKey,
  openOcrText,
  openTagMetadata,
  openThumbnail,
  sealFileMetadata,
  sealFileMetadataBytes,
  sealFolderMetadata,
  sealFolderPrivateKey,
  sealOcrText,
  sealTagMetadata,
  sealThumbnail,
} from './records'
import { seal } from './seal'
import { expectReason, flipBit, pattern } from './test-support'
import {
  asFileKey,
  asFolderPrivateKey,
  asFolderPublicKey,
  asHeaderHash,
  asRootEntropy,
  asSealNonce,
} from './types'

const fileKey = asFileKey(pattern(32, 110))
const otherFileKey = asFileKey(pattern(32, 111))
const headerHash = asHeaderHash(pattern(32, 112))
const otherHeaderHash = asHeaderHash(pattern(32, 113))
const nonce = asSealNonce(pattern(24, 114))
const accountKeys = deriveAccountKeys(asRootEntropy(pattern(32, 115)))
const otherAccountKeys = deriveAccountKeys(asRootEntropy(pattern(32, 116)))

describe('record_version', () => {
  it('puts 0x01 before the record', () => {
    expect(bytesToHex(encodeRecord(Uint8Array.of(0xaa, 0xbb)))).toBe('01aabb')
    expect(encodeRecord(new Uint8Array(0))).toEqual(Uint8Array.of(1))
    expect(decodeRecord(encodeRecord(pattern(120)))).toEqual(pattern(120))
  })

  it('stops at a version that it does not know', () => {
    expectReason(() => decodeRecord(Uint8Array.of(2, 0xaa)), 'unknown_version')
    expectReason(() => decodeRecord(Uint8Array.of(0, 0xaa)), 'unknown_version')
    expectReason(() => decodeRecord(new Uint8Array(0)), 'truncated')
  })

  it('is not an input of seal: the sealed record is the same without it', () => {
    const sealed = sealThumbnail({
      fileKey,
      nonce,
      headerHash,
      thumbnail: pattern(10),
    })
    expect(encodeRecord(sealed).subarray(1)).toEqual(sealed)
  })
})

describe('JSON records', () => {
  it('accepts each JSON object and nothing else', () => {
    expect(decodeJsonObject(utf8('{"name":"a","extra":[1,2]}'))).toEqual({
      name: 'a',
      extra: [1, 2],
    })
    expect(decodeJsonObject(utf8(' {\n} '))).toEqual({})
    for (const text of ['[1]', '"text"', '1', 'null', 'true', '{', '']) {
      expectReason(() => decodeJsonObject(utf8(text)), 'invalid_encoding')
    }
    expectReason(
      () => decodeJsonObject(Uint8Array.of(0x7b, 0xff, 0x7d)),
      'invalid_encoding'
    )
    expectReason(
      () => encodeJsonObject([] as unknown as object),
      'invalid_argument'
    )
  })
})

describe('file metadata', () => {
  const metadata = { name: 'holiday-photo.png', type: 'image/png' }
  const sealedMetadata = sealFileMetadata({
    fileKey,
    nonce,
    headerHash,
    metadata,
  })

  it('is seal(metadata_key, nonce, header_hash, file_metadata)', () => {
    const text = utf8(JSON.stringify(metadata))
    expect(sealedMetadata).toEqual(
      seal(deriveFileKeys(fileKey).metadataKey, nonce, headerHash, text)
    )
    expect(
      sealFileMetadataBytes({ fileKey, nonce, headerHash, fileMetadata: text })
    ).toEqual(sealedMetadata)
  })

  it('round-trips, also with a name that is not ASCII', () => {
    expect(openFileMetadata({ fileKey, headerHash, sealedMetadata })).toEqual(
      metadata
    )
    const unicode = { name: 'résumé \u{1f4c4}.pdf', type: 'application/pdf' }
    expect(
      openFileMetadata({
        fileKey,
        headerHash,
        sealedMetadata: sealFileMetadata({
          fileKey,
          nonce,
          headerHash,
          metadata: unicode,
        }),
      })
    ).toEqual(unicode)
  })

  it('rejects a wrong key, a wrong header_hash and each changed byte', () => {
    expectReason(
      () =>
        openFileMetadata({ fileKey: otherFileKey, headerHash, sealedMetadata }),
      'tag_mismatch'
    )
    expectReason(
      () =>
        openFileMetadata({
          fileKey,
          headerHash: otherHeaderHash,
          sealedMetadata,
        }),
      'tag_mismatch'
    )
    for (let index = 0; index < sealedMetadata.length; index++) {
      expectReason(
        () =>
          openFileMetadata({
            fileKey,
            headerHash,
            sealedMetadata: flipBit(sealedMetadata, index),
          }),
        'tag_mismatch'
      )
    }
  })

  it('rejects authentic content that is not a JSON object', () => {
    const sealedList = sealFileMetadataBytes({
      fileKey,
      nonce,
      headerHash,
      fileMetadata: utf8('["name"]'),
    })
    expectReason(
      () =>
        openFileMetadata({ fileKey, headerHash, sealedMetadata: sealedList }),
      'invalid_encoding'
    )
  })
})

describe('image text and thumbnails', () => {
  const sealedOcrText = sealOcrText({
    fileKey,
    nonce,
    headerHash,
    ocrText: 'Invoice 2026\n€ 12,50',
  })
  const thumbnail = pattern(5000, 9)
  const sealedThumbnail = sealThumbnail({
    fileKey,
    nonce,
    headerHash,
    thumbnail,
  })

  it('uses a separate key for each record type', () => {
    const keys = deriveFileKeys(fileKey)
    expect(sealedOcrText).toEqual(
      seal(keys.ocrTextKey, nonce, headerHash, utf8('Invoice 2026\n€ 12,50'))
    )
    expect(sealedThumbnail).toEqual(
      seal(keys.thumbnailKey, nonce, headerHash, thumbnail)
    )
  })

  it('round-trips', () => {
    expect(openOcrText({ fileKey, headerHash, sealedOcrText })).toBe(
      'Invoice 2026\n€ 12,50'
    )
    expect(openThumbnail({ fileKey, headerHash, sealedThumbnail })).toEqual(
      thumbnail
    )
    expect(
      openOcrText({
        fileKey,
        headerHash,
        sealedOcrText: sealOcrText({ fileKey, nonce, headerHash, ocrText: '' }),
      })
    ).toBe('')
  })

  it('does not open one record type as a different one', () => {
    expectReason(
      () =>
        openThumbnail({ fileKey, headerHash, sealedThumbnail: sealedOcrText }),
      'tag_mismatch'
    )
    expectReason(
      () =>
        openOcrText({ fileKey, headerHash, sealedOcrText: sealedThumbnail }),
      'tag_mismatch'
    )
    expectReason(
      () =>
        openFileMetadata({
          fileKey,
          headerHash,
          sealedMetadata: sealedOcrText,
        }),
      'tag_mismatch'
    )
  })

  it('rejects a wrong key, a wrong header_hash and changed bytes', () => {
    expectReason(
      () => openOcrText({ fileKey: otherFileKey, headerHash, sealedOcrText }),
      'tag_mismatch'
    )
    expectReason(
      () =>
        openOcrText({ fileKey, headerHash: otherHeaderHash, sealedOcrText }),
      'tag_mismatch'
    )
    expectReason(
      () =>
        openThumbnail({
          fileKey: otherFileKey,
          headerHash,
          sealedThumbnail,
        }),
      'tag_mismatch'
    )
    expectReason(
      () =>
        openThumbnail({
          fileKey,
          headerHash: otherHeaderHash,
          sealedThumbnail,
        }),
      'tag_mismatch'
    )
    for (const index of [0, 23, 24, 2500, 5023, 5024, 5055]) {
      expectReason(
        () =>
          openThumbnail({
            fileKey,
            headerHash,
            sealedThumbnail: flipBit(sealedThumbnail, index),
          }),
        'tag_mismatch'
      )
    }
    for (let index = 0; index < sealedOcrText.length; index++) {
      expectReason(
        () =>
          openOcrText({
            fileKey,
            headerHash,
            sealedOcrText: flipBit(sealedOcrText, index),
          }),
        'tag_mismatch'
      )
    }
  })
})

describe('folder records', () => {
  const folderPrivateKey = asFolderPrivateKey(pattern(32, 120))
  const folderPublicKey = folderPublicKeyOf(folderPrivateKey)
  const otherFolderPrivateKey = asFolderPrivateKey(pattern(32, 121))
  const sealedFolderMetadata = sealFolderMetadata({
    folderPrivateKey,
    nonce,
    metadata: { name: 'Screenshots' },
  })
  const sealedFolderPrivateKey = sealFolderPrivateKey({
    accountPrivateKey: accountKeys.accountPrivateKey,
    nonce,
    folderPrivateKey,
  })

  it('derives the keys and seals as section 8.4.2 says', () => {
    expect(folderPublicKey).toEqual(x25519PublicKey(folderPrivateKey))
    const metadataKey = deriveFolderMetadataKey(folderPrivateKey)
    expect(metadataKey).toEqual(
      blake3DeriveKey(CONTEXTS.folderMetadata, folderPrivateKey)
    )
    const ownerKey = deriveFolderOwnerKey(accountKeys.accountPrivateKey)
    expect(ownerKey).toEqual(
      blake3DeriveKey(CONTEXTS.folderOwner, accountKeys.accountPrivateKey)
    )
    expect(sealedFolderMetadata).toEqual(
      seal(metadataKey, nonce, folderPublicKey, utf8('{"name":"Screenshots"}'))
    )
    expect(sealedFolderPrivateKey).toEqual(
      seal(ownerKey, nonce, folderPublicKey, folderPrivateKey)
    )
    expect(sealedFolderPrivateKey).toHaveLength(88)
  })

  it('the folder key opens the name', () => {
    expect(
      openFolderMetadata({ folderPrivateKey, sealedFolderMetadata })
    ).toEqual({ name: 'Screenshots' })
    expectReason(
      () =>
        openFolderMetadata({
          folderPrivateKey: otherFolderPrivateKey,
          sealedFolderMetadata,
        }),
      'tag_mismatch'
    )
    for (const index of [0, 24, sealedFolderMetadata.length - 1]) {
      expectReason(
        () =>
          openFolderMetadata({
            folderPrivateKey,
            sealedFolderMetadata: flipBit(sealedFolderMetadata, index),
          }),
        'tag_mismatch'
      )
    }
  })

  it('the account key opens the folder private key', () => {
    const base = {
      accountPrivateKey: accountKeys.accountPrivateKey,
      folderPublicKey,
      sealedFolderPrivateKey,
    }
    expect(openFolderPrivateKey(base)).toEqual({
      folderPrivateKey,
      folderPublicKey,
    })
    expectReason(
      () =>
        openFolderPrivateKey({
          ...base,
          accountPrivateKey: otherAccountKeys.accountPrivateKey,
        }),
      'tag_mismatch'
    )
    // A record of a different folder does not open for this folder.
    expectReason(
      () =>
        openFolderPrivateKey({
          ...base,
          folderPublicKey: folderPublicKeyOf(otherFolderPrivateKey),
        }),
      'tag_mismatch'
    )
    for (let index = 0; index < sealedFolderPrivateKey.length; index++) {
      expectReason(
        () =>
          openFolderPrivateKey({
            ...base,
            sealedFolderPrivateKey: flipBit(sealedFolderPrivateKey, index),
          }),
        'tag_mismatch'
      )
    }
    expectReason(
      () =>
        openFolderPrivateKey({
          ...base,
          sealedFolderPrivateKey: sealedFolderPrivateKey.subarray(0, 87),
        }),
      'bad_length'
    )
  })

  it('rejects a record whose private key does not give the listed public key', () => {
    const listed = asFolderPublicKey(pattern(32, 122))
    const inconsistent = seal(
      deriveFolderOwnerKey(accountKeys.accountPrivateKey),
      nonce,
      listed,
      folderPrivateKey
    )
    expectReason(
      () =>
        openFolderPrivateKey({
          accountPrivateKey: accountKeys.accountPrivateKey,
          folderPublicKey: listed,
          sealedFolderPrivateKey: inconsistent,
        }),
      'key_mismatch'
    )
  })
})

describe('tag records', () => {
  const metadata = {
    name: 'Invoices',
    rule_source: 'filename' as const,
    rule_text: 'invoice',
  }
  const base = {
    accountPrivateKey: accountKeys.accountPrivateKey,
    accountPublicKey: accountKeys.accountPublicKey,
  }
  const sealedTagMetadata = sealTagMetadata({ ...base, nonce, metadata })

  it('is seal(tag_key, nonce, account_public_key, tag_metadata)', () => {
    const tagKey = deriveTagKey(accountKeys.accountPrivateKey)
    expect(tagKey).toEqual(
      blake3DeriveKey(CONTEXTS.tagMetadata, accountKeys.accountPrivateKey)
    )
    expect(sealedTagMetadata).toEqual(
      seal(
        tagKey,
        nonce,
        accountKeys.accountPublicKey,
        utf8(JSON.stringify(metadata))
      )
    )
  })

  it('round-trips, with and without a rule', () => {
    expect(openTagMetadata({ ...base, sealedTagMetadata })).toEqual(metadata)
    const plain = sealTagMetadata({
      ...base,
      nonce,
      metadata: { name: 'Work' },
    })
    expect(openTagMetadata({ ...base, sealedTagMetadata: plain })).toEqual({
      name: 'Work',
    })
  })

  it('rejects a different account key and each changed byte', () => {
    expectReason(
      () =>
        openTagMetadata({
          accountPrivateKey: otherAccountKeys.accountPrivateKey,
          accountPublicKey: accountKeys.accountPublicKey,
          sealedTagMetadata,
        }),
      'tag_mismatch'
    )
    expectReason(
      () =>
        openTagMetadata({
          accountPrivateKey: accountKeys.accountPrivateKey,
          accountPublicKey: otherAccountKeys.accountPublicKey,
          sealedTagMetadata,
        }),
      'tag_mismatch'
    )
    for (let index = 0; index < sealedTagMetadata.length; index++) {
      expectReason(
        () =>
          openTagMetadata({
            ...base,
            sealedTagMetadata: flipBit(sealedTagMetadata, index),
          }),
        'tag_mismatch'
      )
    }
  })
})
