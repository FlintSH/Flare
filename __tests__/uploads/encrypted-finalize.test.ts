import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import {
  accountKeysFromPrivateKey,
  base64urlDecode,
  storedLengthOf,
} from '@/lib/e2ee'
import { newEncryptedFile } from '@/lib/e2ee/client/files'
import type { AccountPrivateKey } from '@/lib/e2ee/types'
import { parseEncryptedRecords } from '@/lib/files/encrypted'
import { DEFAULT_PERMISSIONS } from '@/lib/permissions/catalog'
import type { StorageProvider } from '@/lib/storage'
import { enqueueUploadProcessing, finalizeUpload } from '@/lib/uploads/finalize'
import { uploadLinks } from '@/lib/uploads/links'
import { mergeUploadOptions } from '@/lib/uploads/schema'

const mocks = vi.hoisted(() => ({
  applyProfileTags: vi.fn(),
  applyAutomaticTags: vi.fn(),
  enqueueFileReady: vi.fn(),
  validateFileType: vi.fn(),
  ocrAdd: vi.fn(),
  transaction: vi.fn(),
  tx: {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    config: { findUnique: vi.fn() },
    role: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    file: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    vaultFolder: { findFirst: vi.fn() },
    apiToken: { findUnique: vi.fn() },
    uploadProfile: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { $transaction: mocks.transaction },
}))
vi.mock('@/lib/tags/service', () => ({
  applyProfileTags: mocks.applyProfileTags,
  applyAutomaticTags: mocks.applyAutomaticTags,
  validateOwnedTagIds: vi.fn(),
  TagError: class extends Error {},
}))
vi.mock('@/lib/config', () => ({
  readConfig: async () => ({
    settings: {
      general: {
        storage: {
          maxUploadSize: { value: 10, unit: 'MB' },
          quotas: { enabled: false, default: { value: 10, unit: 'GB' } },
        },
      },
    },
  }),
}))
vi.mock('@/lib/security/file-validation', () => ({
  validateFileType: mocks.validateFileType,
}))
vi.mock('@/lib/integrations/webhooks', () => ({
  enqueueFileReady: mocks.enqueueFileReady,
}))
vi.mock('@/lib/ocr', () => ({ ocrQueue: { add: mocks.ocrAdd } }))

const account = accountKeysFromPrivateKey(
  Uint8Array.from({ length: 32 }, (_, i) => i + 77) as AccountPrivateKey
)
const rotated = accountKeysFromPrivateKey(
  Uint8Array.from({ length: 32 }, (_, i) => 250 - i) as AccountPrivateKey
)
const created = newEncryptedFile({
  name: 'tax return 2026.png',
  type: 'image/png',
  accountPublicKey: account.accountPublicKey,
})
const records = parseEncryptedRecords(created.records)
const header = Buffer.from(base64urlDecode(created.records.header))
const size = storedLengthOf(1000)
const body = Buffer.concat([header, Buffer.alloc(size - 26, 0x5a)])

const user: AuthenticatedUser = {
  id: 'alice',
  storageUsed: 0,
  urlId: 'alice',
  vanityId: null,
  roles: [],
  permissions: [...DEFAULT_PERMISSIONS],
  randomizeFileUrls: false,
  credential: 'session',
}
const fileId = 'e_0123456789abcdefghijkl'
const input = (stored: Buffer = body) => ({
  user,
  storage: {
    kind: 'local',
    target: { provider: 'local' },
    getFileStream: async () => Readable.from([stored.subarray(0, 4100)]),
  } as unknown as StorageProvider,
  filePath: `uploads/alice/object/${fileId}`,
  urlPath: `/alice/${fileId}`,
  displayName: '',
  mimeType: 'application/octet-stream',
  size: stored.length,
  options: mergeUploadOptions({}, { tagIds: ['work'] }, {}),
  encrypted: records,
})

beforeEach(() => {
  vi.resetAllMocks()
  mocks.validateFileType.mockResolvedValue({ valid: true })
  mocks.tx.config.findUnique.mockResolvedValue(null)
  mocks.tx.user.findUnique.mockResolvedValue({
    ...user,
    accountPublicKey: account.accountPublicKey,
  })
  mocks.tx.role.findUnique.mockResolvedValue({
    id: 'everyone',
    name: 'Everyone',
    position: 0,
    systemKey: 'everyone',
    permissions: [...DEFAULT_PERMISSIONS],
  })
  mocks.tx.file.findFirst.mockResolvedValue(null)
  mocks.tx.file.findUnique.mockResolvedValue(null)
  mocks.tx.file.create.mockImplementation(async ({ data }) => ({
    id: 'file-one',
    ...data,
  }))
  mocks.transaction.mockImplementation((callback) => callback(mocks.tx))
})

describe('publishing an encrypted upload', () => {
  it('stores the records, no name and no type, and counts the ciphertext', async () => {
    await finalizeUpload(input())
    const { data } = mocks.tx.file.create.mock.calls[0][0]
    expect(data).toMatchObject({
      name: '',
      mimeType: 'application/octet-stream',
      urlPath: `/alice/${fileId}`,
      path: `uploads/alice/object/${fileId}`,
      password: null,
      encrypted: true,
      header: records.header,
      sealedMetadata: records.sealedMetadata,
      accountStanza: records.accountStanza,
      stanzaAccountPublicKey: records.stanzaAccountPublicKey,
      passwordStanza: null,
      size: size / 1024 ** 2,
    })
    expect(JSON.stringify(data)).not.toContain('tax return')
    expect(mocks.tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { storageUsed: { increment: size / 1024 ** 2 } },
      })
    )
  })

  it('does not look for a type in ciphertext, run name rules, or queue text recognition', async () => {
    const file = await finalizeUpload(input())
    expect(mocks.validateFileType).not.toHaveBeenCalled()
    expect(mocks.applyAutomaticTags).not.toHaveBeenCalled()
    // Tags chosen by ID are visible metadata and still apply.
    expect(mocks.applyProfileTags).toHaveBeenCalledOnce()
    expect(mocks.ocrAdd).not.toHaveBeenCalled()
    enqueueUploadProcessing({ ...file, mimeType: 'image/png', encrypted: true })
    expect(mocks.ocrAdd).not.toHaveBeenCalled()
    expect(mocks.enqueueFileReady).toHaveBeenCalledOnce()
  })

  it('refuses stored bytes that do not start with the header of this upload', async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(size - 8),
    ])
    await expect(finalizeUpload(input(png))).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/do not start with the file header/),
    })
    const otherNonce = Buffer.from(body)
    otherNonce[20] ^= 0xff
    await expect(finalizeUpload(input(otherNonce))).rejects.toMatchObject({
      status: 400,
    })
    expect(mocks.tx.file.create).not.toHaveBeenCalled()
  })

  it('refuses a stored size that no encrypted file has', async () => {
    const short = body.subarray(0, 26 + 20)
    await expect(finalizeUpload(input(short))).rejects.toMatchObject({
      status: 400,
    })
    const upload = input()
    upload.size = 26 + 65568 + 32
    await expect(finalizeUpload(upload)).rejects.toMatchObject({ status: 400 })
  })

  it('refuses a name, a type or a server password next to the records', async () => {
    await expect(
      finalizeUpload({ ...input(), displayName: 'tax return 2026.png' })
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      finalizeUpload({ ...input(), mimeType: 'image/png' })
    ).rejects.toMatchObject({ status: 400 })
    const upload = input()
    upload.options = { ...upload.options, password: 'server-password-1' }
    await expect(finalizeUpload(upload)).rejects.toMatchObject({ status: 400 })
  })

  it('refuses a stanza for a key the account rotated away, under the user lock', async () => {
    mocks.tx.user.findUnique.mockResolvedValue({
      ...user,
      accountPublicKey: rotated.accountPublicKey,
    })
    await expect(finalizeUpload(input())).rejects.toMatchObject({ status: 409 })
    mocks.tx.user.findUnique.mockResolvedValue({
      ...user,
      accountPublicKey: null,
    })
    await expect(finalizeUpload(input())).rejects.toMatchObject({ status: 409 })
    expect(mocks.tx.file.create).not.toHaveBeenCalled()
  })

  it('refuses ciphertext that arrives as a plain upload', async () => {
    const upload = {
      ...input(),
      encrypted: null,
      displayName: 'backup.bin',
      urlPath: '/alice/backup.bin',
    }
    await expect(finalizeUpload(upload)).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/encrypted Flare file/),
    })
  })

  it('leaves a plain upload exactly as it was', async () => {
    const plain = Buffer.from('plain text file')
    await finalizeUpload({
      ...input(plain),
      encrypted: undefined,
      displayName: 'notes.txt',
      mimeType: 'text/plain',
      urlPath: '/alice/notes.txt',
      filePath: 'uploads/alice/object/notes.txt',
    })
    const { data } = mocks.tx.file.create.mock.calls[0][0]
    expect(data).toMatchObject({ name: 'notes.txt', mimeType: 'text/plain' })
    for (const field of [
      'encrypted',
      'header',
      'sealedMetadata',
      'accountStanza',
    ])
      expect(field in data, field).toBe(false)
    expect(mocks.validateFileType).toHaveBeenCalledOnce()
    expect(mocks.applyAutomaticTags).toHaveBeenCalledOnce()
  })
})

describe('what an upload answers', () => {
  const owner = { urlId: 'alice', vanityId: null }

  it('gives an encrypted upload its address and size, and no name, type or raw address', () => {
    const answer = uploadLinks(
      {
        id: 'file-one',
        urlPath: `/alice/${fileId}`,
        name: '',
        mimeType: 'application/octet-stream',
        size: size / 1024 ** 2,
        encrypted: true,
      },
      owner
    )
    expect(answer).toEqual({
      encrypted: true,
      id: 'file-one',
      url: expect.stringMatching(new RegExp(`/alice/${fileId}$`)),
      pageUrl: expect.stringMatching(new RegExp(`/alice/${fileId}$`)),
      size,
    })
    expect(JSON.stringify(answer)).not.toContain('#')
  })

  it('answers a plain upload as before', () => {
    const answer = uploadLinks(
      {
        id: 'file-two',
        urlPath: '/alice/shot.png',
        name: 'shot.png',
        mimeType: 'image/png',
        size: 1,
      },
      owner
    )
    expect(Object.keys(answer)).toEqual([
      'url',
      'pageUrl',
      'rawUrl',
      'downloadUrl',
      'copyText',
      'name',
      'size',
      'type',
    ])
  })
})
