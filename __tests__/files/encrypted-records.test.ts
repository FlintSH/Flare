import { describe, expect, it } from 'vitest'

import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import {
  accountKeysFromPrivateKey,
  base64urlDecode,
  base64urlEncode,
  storedLengthOf,
} from '@/lib/e2ee'
import { newEncryptedFile } from '@/lib/e2ee/client/files'
import type { AccountPrivateKey } from '@/lib/e2ee/types'
import {
  ENCRYPTED_FILE_NAME,
  ENCRYPTED_FILE_TYPE,
  assertCiphertextLength,
  assertEncryptedBody,
  assertStanzaForAccount,
  auditFileName,
  encryptedDestination,
  encryptedRecordsWire,
  parseEncryptedRecords,
  startsWithEncryptedMagic,
} from '@/lib/files/encrypted'
import {
  encryptedFileId,
  isEncryptedFileId,
  isEncryptedFilePath,
} from '@/lib/files/encrypted-id'
import { exportEntryNamer } from '@/lib/files/export-entry-names'
import { HttpError } from '@/lib/http/errors'
import {
  assertEncryptedUploader,
  parseEncryptedInit,
  splitEncryptedFields,
} from '@/lib/uploads/encrypted'

const account = accountKeysFromPrivateKey(
  Uint8Array.from({ length: 32 }, (_, i) => i + 9) as AccountPrivateKey
)
const other = accountKeysFromPrivateKey(
  Uint8Array.from({ length: 32 }, (_, i) => 200 - i) as AccountPrivateKey
)
const created = newEncryptedFile({
  name: 'secret plan.pdf',
  type: 'application/pdf',
  accountPublicKey: account.accountPublicKey,
})
const wire = created.records
const records = parseEncryptedRecords(wire)
const header = base64urlDecode(wire.header)

function refusal(run: () => unknown) {
  try {
    run()
  } catch (error) {
    if (error instanceof HttpError) return error
    throw error
  }
  throw new Error('It was accepted')
}

const changed = (text: string, at: number, to: number) => {
  const bytes = base64urlDecode(text)
  bytes[at] = to
  return base64urlEncode(bytes)
}

describe('records of an encrypted upload', () => {
  it('accepts what the browser makes and keeps the bytes as sent', () => {
    expect(records.header).toHaveLength(26)
    expect(records.accountStanza).toHaveLength(97)
    expect(records.stanzaAccountPublicKey).toHaveLength(32)
    expect(records.passwordStanza).toBeNull()
    expect(base64urlEncode(records.sealedMetadata)).toBe(wire.sealedMetadata)
  })

  it('refuses a header with the wrong magic, version or chunk size', () => {
    for (const [at, to] of [
      [0, 0x58], // magic
      [8, 0x02], // format_version
      [9, 15], // chunk_size_log2
    ])
      expect(
        refusal(() =>
          parseEncryptedRecords({
            ...wire,
            header: changed(wire.header, at, to),
          })
        ).status
      ).toBe(400)
    expect(
      refusal(() =>
        parseEncryptedRecords({
          ...wire,
          header: base64urlEncode(header.subarray(0, 25)),
        })
      ).status
    ).toBe(400)
  })

  it('refuses a stanza or a sealed record of an impossible length or version', () => {
    const stanza = base64urlDecode(wire.accountStanza)
    for (const bad of [
      { accountStanza: base64urlEncode(stanza.subarray(0, 96)) },
      { accountStanza: changed(wire.accountStanza, 0, 2) },
      { sealedMetadata: base64urlEncode(new Uint8Array(40).fill(1)) },
      { sealedMetadata: changed(wire.sealedMetadata, 0, 9) },
      { sealedMetadata: base64urlEncode(new Uint8Array(5000).fill(1)) },
      { stanzaAccountPublicKey: base64urlEncode(new Uint8Array(31)) },
      { passwordStanza: base64urlEncode(new Uint8Array(216).fill(1)) },
      { passwordStanza: wire.accountStanza },
    ])
      expect(
        refusal(() => parseEncryptedRecords({ ...wire, ...bad })).status,
        Object.keys(bad)[0]
      ).toBe(400)
  })

  it('refuses a body that does not start with the header it named', () => {
    const body = new Uint8Array(storedLengthOf(10))
    body.set(header)
    expect(() => assertEncryptedBody(body, body.length, records)).not.toThrow()
    const plain = new TextEncoder().encode(
      '%PDF-1.7 a plain document, not ciphertext'
    )
    expect(
      refusal(() => assertEncryptedBody(plain, plain.length, records)).message
    ).toMatch(/do not start with the file header/)
    // The right magic, a different nonce prefix: not this upload's file.
    const otherHeader = body.slice()
    otherHeader[25] ^= 1
    expect(
      refusal(() => assertEncryptedBody(otherHeader, body.length, records))
        .status
    ).toBe(400)
    expect(
      refusal(() => assertEncryptedBody(header.subarray(0, 20), 20, records))
        .status
    ).toBe(400)
  })

  it('refuses a stored length that no encrypted file has', () => {
    for (const plaintext of [0, 1, 65535, 65536, 65537, 11 * 1024 * 1024])
      expect(() =>
        assertCiphertextLength(storedLengthOf(plaintext))
      ).not.toThrow()
    for (const size of [
      0,
      25,
      26, // a header and no chunk
      26 + 31, // a chunk shorter than its tag
      26 + 65568 + 10, // a last chunk shorter than its tag
      26 + 65568 + 32, // an empty final chunk after a full one
    ])
      expect(
        refusal(() => assertCiphertextLength(size)).status,
        String(size)
      ).toBe(400)
    const body = new Uint8Array(100)
    body.set(header)
    expect(
      refusal(() => assertEncryptedBody(body, 26 + 31, records)).status
    ).toBe(400)
  })

  it('recognizes ciphertext sent as a plain upload', () => {
    expect(startsWithEncryptedMagic(header)).toBe(true)
    expect(
      startsWithEncryptedMagic(new TextEncoder().encode('FLAREE2E is a word'))
    ).toBe(false)
    expect(startsWithEncryptedMagic(new Uint8Array(0))).toBe(false)
  })

  it('refuses a stanza for a key that is not the uploader’s current account key', () => {
    expect(() =>
      assertStanzaForAccount(records, account.accountPublicKey)
    ).not.toThrow()
    expect(
      refusal(() => assertStanzaForAccount(records, other.accountPublicKey))
        .status
    ).toBe(409)
    expect(refusal(() => assertStanzaForAccount(records, null)).status).toBe(
      409
    )
  })

  it('sends the account stanza to the owner only', () => {
    const stored = {
      encrypted: true,
      header: records.header,
      sealedMetadata: records.sealedMetadata,
      accountStanza: records.accountStanza,
      stanzaAccountPublicKey: records.stanzaAccountPublicKey,
      passwordStanza: null,
    }
    const owner = encryptedRecordsWire(stored, { forOwner: true })
    const visitor = encryptedRecordsWire(stored, { forOwner: false })
    expect(owner).toMatchObject({
      header: wire.header,
      sealedMetadata: wire.sealedMetadata,
      accountStanza: wire.accountStanza,
      stanzaAccountPublicKey: wire.stanzaAccountPublicKey,
      passwordStanza: null,
    })
    expect(visitor).toEqual({
      header: wire.header,
      sealedMetadata: wire.sealedMetadata,
      passwordStanza: null,
    })
    expect(
      encryptedRecordsWire(
        { ...stored, encrypted: false, header: null, sealedMetadata: null },
        { forOwner: true }
      )
    ).toBeNull()
  })

  it('gives audit records no name for an encrypted file', () => {
    expect(auditFileName({ name: '', encrypted: true })).toBeUndefined()
    expect(auditFileName({ name: 'a.png', encrypted: false })).toBe('a.png')
    expect(ENCRYPTED_FILE_NAME).toBe('')
    expect(ENCRYPTED_FILE_TYPE).toBe('application/octet-stream')
  })
})

describe('address of an encrypted file (section 10.3)', () => {
  it('is random, URL-safe and holds no name', () => {
    const destination = encryptedDestination({ urlId: 'alexm' }, 'object-id')
    expect(destination.urlPath).toMatch(/^\/alexm\/e_[A-Za-z0-9_-]{22}$/)
    expect(destination.filePath).toBe(
      `uploads/alexm/object-id/${destination.urlSafeName}`
    )
    expect(destination.displayName).toBe('')
    expect(encryptedDestination({ urlId: 'alexm' }, 'x').urlPath).not.toBe(
      destination.urlPath
    )
    expect(encryptedFileId(new Uint8Array(16).fill(255))).toBe(
      `e_${'_'.repeat(21)}w`
    )
  })

  it('is told apart from a plain file’s URL name without the database', () => {
    const id = encryptedDestination({ urlId: 'a' }, 'x').urlSafeName
    expect(isEncryptedFileId(id)).toBe(true)
    expect(isEncryptedFilePath(`/alexm/${id}`)).toBe(true)
    expect(isEncryptedFilePath(`/alexm/${id}/raw`)).toBe(true)
    for (const name of [
      'screenshot.png',
      'readme',
      'my-very-long-readme-file',
      'e_short',
      `${id}.png`,
      'a1b2c3.png',
    ]) {
      expect(isEncryptedFileId(name), name).toBe(false)
      expect(isEncryptedFilePath(`/alexm/${name}`), name).toBe(false)
    }
    expect(isEncryptedFilePath(`/${id}`)).toBe(false)
    expect(isEncryptedFilePath(`/a/b/${id}/raw/x`)).toBe(false)
  })

  it('names an export entry by the file ID, with no clash with plain names', () => {
    const name = exportEntryNamer()
    const uploadedAt = new Date('2026-11-10T10:00:00Z')
    expect(
      name({ name: '', uploadedAt, encrypted: true, urlPath: '/alexm/e_abc' })
    ).toBe('files/2026-11-10/e_abc.flare-encrypted')
    expect(name({ name: 'photo.png', uploadedAt })).toBe(
      'files/2026-11-10/photo.png'
    )
  })
})

describe('form fields of an encrypted upload', () => {
  const fields = { ...wire, visibility: 'PRIVATE' }

  it('splits the records from the options', () => {
    const split = splitEncryptedFields(fields)
    expect(split.options).toEqual({ visibility: 'PRIVATE' })
    expect(base64urlEncode(split.records.header)).toBe(wire.header)
  })

  it('refuses a plaintext name, a type, or any other unknown field', () => {
    for (const field of [
      'name',
      'filename',
      'mimeType',
      'type',
      'originalName',
      'fileKey',
    ])
      expect(
        refusal(() =>
          splitEncryptedFields({ ...fields, [field]: 'holiday.png' })
        ).message,
        field
      ).toBe(`An encrypted upload cannot carry the field "${field}".`)
  })

  it('refuses a server password', () => {
    expect(
      refusal(() =>
        splitEncryptedFields({ ...fields, password: 'hunter22222' })
      ).message
    ).toMatch(/password stanza, not a server password/)
  })

  it('refuses an upload that lacks a record', () => {
    for (const missing of [
      'header',
      'sealedMetadata',
      'accountStanza',
      'stanzaAccountPublicKey',
    ] as const) {
      const { [missing]: _removed, ...rest } = fields
      expect(refusal(() => splitEncryptedFields(rest)).status, missing).toBe(
        400
      )
    }
  })
})

describe('start of an encrypted chunked upload', () => {
  const init = {
    encrypted: true,
    size: storedLengthOf(11 * 1024 * 1024),
    ...wire,
  }

  it('accepts the records, the ciphertext size and the visible options', () => {
    const parsed = parseEncryptedInit({
      ...init,
      visibility: 'PUBLIC',
      folderId: null,
    })
    expect(parsed.size).toBe(init.size)
    expect(parsed.encrypted.passwordStanza).toBeNull()
    expect(parsed.bodyOptions).toEqual({ visibility: 'PUBLIC', folderId: null })
  })

  it('refuses a file name, a file type and a server password', () => {
    for (const extra of [
      { filename: 'holiday.png' },
      { mimeType: 'image/png' },
      { name: 'holiday.png' },
      { password: 'hunter22222' },
      { fileKey: 'x' },
    ])
      expect(
        refusal(() => parseEncryptedInit({ ...init, ...extra })).status
      ).toBe(400)
  })

  it('refuses a missing record, an impossible size and encrypted: false', () => {
    const { accountStanza: _removed, ...withoutStanza } = init
    expect(refusal(() => parseEncryptedInit(withoutStanza)).status).toBe(400)
    expect(
      refusal(() => parseEncryptedInit({ ...init, size: 26 + 65568 + 32 }))
        .status
    ).toBe(400)
    expect(
      refusal(() => parseEncryptedInit({ ...init, size: 20 })).status
    ).toBe(400)
    expect(
      refusal(() => parseEncryptedInit({ ...init, encrypted: false })).status
    ).toBe(400)
    expect(
      refusal(() =>
        parseEncryptedInit({ ...init, header: changed(wire.header, 0, 0) })
      ).status
    ).toBe(400)
  })
})

describe('who can send an encrypted upload in this release', () => {
  const user = { credential: 'session' } as AuthenticatedUser

  it('is a browser session, not a token', () => {
    expect(() => assertEncryptedUploader(user)).not.toThrow()
    expect(
      refusal(() =>
        assertEncryptedUploader({ ...user, credential: 'upload-token' })
      ).status
    ).toBe(403)
    expect(
      refusal(() =>
        assertEncryptedUploader({
          ...user,
          credential: 'token',
          apiToken: { id: 't', scopes: ['files:upload'], profileId: null },
        })
      ).status
    ).toBe(403)
  })
})
