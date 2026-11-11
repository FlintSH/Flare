import { describe, expect, it } from 'vitest'

import { deriveAccountKeys } from '@/lib/e2ee/account'
import { CONTEXTS } from '@/lib/e2ee/contexts'
import { deriveFileKeys } from '@/lib/e2ee/file'
import {
  blake3DeriveKey,
  bytesToHex,
  utf8,
  x25519PublicKey,
} from '@/lib/e2ee/primitives'
import {
  STORED_RECORD_KINDS,
  type StoredRecordKind,
  decodeJsonObject,
  decodeRecord,
  decodeStoredRecord,
  deriveFolderMetadataKey,
  deriveFolderOwnerKey,
  deriveTagKey,
  encodeJsonObject,
  encodeRecord,
  encodeStoredRecord,
  folderPublicKeyOf,
  jsonValue,
  openFileMetadata,
  openFolderMetadata,
  openFolderPrivateKey,
  openOcrText,
  openTagMetadata,
  openThumbnail,
  readTagMetadata,
  sealFileMetadata,
  sealFileMetadataBytes,
  sealFolderMetadata,
  sealFolderPrivateKey,
  sealOcrText,
  sealTagMetadata,
  sealThumbnail,
} from '@/lib/e2ee/records'
import { seal } from '@/lib/e2ee/seal'
import {
  asFileKey,
  asFolderPrivateKey,
  asFolderPublicKey,
  asHeaderHash,
  asRootEntropy,
  asSealNonce,
} from '@/lib/e2ee/types'

import { expectReason, flipBit, pattern } from './test-support'

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

describe('record_version of each stored record type', () => {
  // A possible length of each type, without the version byte.
  const LENGTHS: Record<StoredRecordKind, number> = {
    wrapped_root: 88,
    sealed_keyring: 56 + 64,
    sealed_metadata: 56 + 40,
    sealed_ocr_text: 56,
    sealed_thumbnail: 56 + 5000,
    sealed_tag_metadata: 56 + 20,
    sealed_folder_metadata: 56 + 15,
    sealed_folder_private_key: 88,
    account_stanza: 96,
    password_stanza: 216,
    folder_file_stanza: 96,
    folder_link_secret_stanza: 96,
    parent_folder_stanza: 96,
  }

  it('covers each type of section 4.4, rule 12', () => {
    expect([...STORED_RECORD_KINDS].sort()).toEqual(Object.keys(LENGTHS).sort())
    for (const name of [
      'wrapped_root',
      'sealed_keyring',
      'sealed_metadata',
      'sealed_ocr_text',
      'sealed_thumbnail',
      'sealed_tag_metadata',
      'sealed_folder_metadata',
      'sealed_folder_private_key',
    ]) {
      expect(STORED_RECORD_KINDS).toContain(name)
    }
  })

  it.each(STORED_RECORD_KINDS)('%s is stored as 0x01 || record', (kind) => {
    const record = pattern(LENGTHS[kind], 7)
    const stored = encodeStoredRecord(kind, record)
    expect(stored).toHaveLength(record.length + 1)
    expect(stored[0]).toBe(0x01)
    expect(stored.subarray(1)).toEqual(record)
    expect(stored).toEqual(encodeRecord(record))
    expect(decodeStoredRecord(kind, stored)).toEqual(record)
    const unknown = stored.slice()
    unknown[0] = 0x02
    expectReason(() => decodeStoredRecord(kind, unknown), 'unknown_version')
    expectReason(() => decodeStoredRecord(kind, new Uint8Array(0)), 'truncated')
    // A record without the byte is not a stored record. Its first byte is
    // not 0x01 here, so the version check stops it.
    expectReason(() => decodeStoredRecord(kind, record), 'unknown_version')
  })

  it('rejects a length that the type cannot have, in both directions', () => {
    const impossible: Array<[StoredRecordKind, number[]]> = [
      ['wrapped_root', [87, 89, 56]],
      // No sealed empty list, and only whole keys.
      ['sealed_keyring', [56, 57, 87, 89]],
      ['sealed_metadata', [0, 55]],
      ['sealed_ocr_text', [55]],
      ['sealed_thumbnail', [55]],
      ['sealed_tag_metadata', [55]],
      ['sealed_folder_metadata', [55]],
      ['sealed_folder_private_key', [87, 89]],
      // 120 and 240 are the stanza lengths of draft 17.
      ['account_stanza', [95, 97, 120]],
      ['password_stanza', [215, 217, 240]],
      ['folder_file_stanza', [95, 97, 120]],
      ['folder_link_secret_stanza', [95, 97, 120]],
      ['parent_folder_stanza', [95, 97, 120]],
    ]
    for (const [kind, lengths] of impossible) {
      for (const length of lengths) {
        const record = pattern(length, 7)
        expectReason(() => encodeStoredRecord(kind, record), 'bad_length')
        expectReason(
          () => decodeStoredRecord(kind, encodeRecord(record)),
          'bad_length'
        )
      }
    }
    expectReason(
      () =>
        encodeStoredRecord('file' as unknown as StoredRecordKind, pattern(96)),
      'invalid_argument'
    )
    expectReason(
      () =>
        encodeStoredRecord(
          'constructor' as unknown as StoredRecordKind,
          pattern(96)
        ),
      'invalid_argument'
    )
  })

  it('agrees with the records that the library makes', () => {
    const sealedFolderPrivateKey = sealFolderPrivateKey({
      accountPrivateKey: accountKeys.accountPrivateKey,
      nonce,
      folderPrivateKey: asFolderPrivateKey(pattern(32, 120)),
    })
    expect(
      decodeStoredRecord(
        'sealed_folder_private_key',
        encodeStoredRecord('sealed_folder_private_key', sealedFolderPrivateKey)
      )
    ).toEqual(sealedFolderPrivateKey)
    const emptyOcrText = sealOcrText({
      fileKey,
      nonce,
      headerHash,
      ocrText: '',
    })
    expect(encodeStoredRecord('sealed_ocr_text', emptyOcrText)).toHaveLength(57)
  })
})

describe('tag metadata reader (section 4.4, rule 9)', () => {
  it('reads absent and null as the same "no value"', () => {
    const noValue = { name: 'invoices', rule_source: null, rule_text: null }
    expect(readTagMetadata({ name: 'invoices' })).toEqual(noValue)
    expect(
      readTagMetadata({ name: 'invoices', rule_source: null, rule_text: null })
    ).toEqual(noValue)
    expect(readTagMetadata({ name: 'invoices', rule_text: null })).toEqual(
      noValue
    )
    expect(
      readTagMetadata({ name: 'invoices', rule_source: undefined })
    ).toEqual(noValue)
  })

  it('reads a rule and ignores fields that it does not know', () => {
    expect(
      readTagMetadata({
        name: 'invoices',
        rule_source: 'filename',
        rule_text: 'invoice',
        colour: 'red',
      })
    ).toEqual({
      name: 'invoices',
      rule_source: 'filename',
      rule_text: 'invoice',
    })
    expect(
      readTagMetadata({ name: 't', rule_source: 'ocr', rule_text: '' })
    ).toEqual({ name: 't', rule_source: 'ocr', rule_text: '' })
    expect(readTagMetadata({ name: '' }).name).toBe('')
  })

  it('gives the same result for both forms through seal and open', () => {
    const base = {
      accountPrivateKey: accountKeys.accountPrivateKey,
      accountPublicKey: accountKeys.accountPublicKey,
    }
    const results = [
      { name: 'x' },
      { name: 'x', rule_source: null, rule_text: null },
    ].map((metadata) =>
      readTagMetadata(
        openTagMetadata({
          ...base,
          sealedTagMetadata: sealTagMetadata({ ...base, nonce, metadata }),
        })
      )
    )
    expect(results[0]).toEqual(results[1])
    expect(results[0]).toEqual({
      name: 'x',
      rule_source: null,
      rule_text: null,
    })
  })

  it('rejects a missing name and values of a wrong type', () => {
    const invalid = [
      {},
      { name: null },
      { name: 5 },
      { name: 'x', rule_source: 'content' },
      { name: 'x', rule_source: 1 },
      { name: 'x', rule_source: '' },
      { name: 'x', rule_text: 5 },
      { name: 'x', rule_text: ['a'] },
    ]
    for (const record of invalid) {
      expectReason(() => readTagMetadata(record), 'invalid_encoding')
    }
  })

  it('jsonValue treats absent and null the same, and ignores inherited fields', () => {
    expect(jsonValue({ a: null }, 'a')).toBeUndefined()
    expect(jsonValue({}, 'a')).toBeUndefined()
    expect(jsonValue({ a: 0 }, 'a')).toBe(0)
    expect(jsonValue({ a: '' }, 'a')).toBe('')
    expect(jsonValue({ a: false }, 'a')).toBe(false)
    expect(jsonValue({}, 'toString')).toBeUndefined()
    expect(jsonValue({}, 'constructor')).toBeUndefined()
  })
})

describe('canonical folder public key', () => {
  it('rejects a listed folder_public_key that is not canonical', () => {
    const folderPrivateKey = asFolderPrivateKey(pattern(32, 121))
    const sealedFolderPrivateKey = sealFolderPrivateKey({
      accountPrivateKey: accountKeys.accountPrivateKey,
      nonce,
      folderPrivateKey,
    })
    const listed = folderPublicKeyOf(folderPrivateKey)
    expect(
      openFolderPrivateKey({
        accountPrivateKey: accountKeys.accountPrivateKey,
        folderPublicKey: listed,
        sealedFolderPrivateKey,
      }).folderPrivateKey
    ).toEqual(folderPrivateKey)
    // The same point with the highest bit set.
    const otherForm = listed.slice()
    otherForm[31] |= 0x80
    const prime = new Uint8Array(32).fill(0xff)
    prime[0] = 0xed
    prime[31] = 0x7f
    for (const key of [otherForm, prime]) {
      expectReason(
        () =>
          openFolderPrivateKey({
            accountPrivateKey: accountKeys.accountPrivateKey,
            folderPublicKey: asFolderPublicKey(key),
            sealedFolderPrivateKey,
          }),
        'non_canonical_public_key'
      )
    }
  })

  it('stores a folder private key as it is, without clamping', () => {
    const raw = asFolderPrivateKey(pattern(32, 122))
    raw[0] |= 0x07
    raw[31] |= 0x80
    raw[31] &= 0xbf
    const before = raw.slice()
    const sealedFolderPrivateKey = sealFolderPrivateKey({
      accountPrivateKey: accountKeys.accountPrivateKey,
      nonce,
      folderPrivateKey: raw,
    })
    // The public key comes from the clamped scalar; the stored key does not change.
    expect(raw).toEqual(before)
    const opened = openFolderPrivateKey({
      accountPrivateKey: accountKeys.accountPrivateKey,
      folderPublicKey: folderPublicKeyOf(raw),
      sealedFolderPrivateKey,
    })
    expect(opened.folderPrivateKey).toEqual(before)
  })
})
