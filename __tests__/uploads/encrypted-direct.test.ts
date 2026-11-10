import { POST as upload } from '@/app/api/files/route'
import type { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import {
  accountKeysFromPrivateKey,
  base64urlDecode,
  storedLengthOf,
} from '@/lib/e2ee'
import { newEncryptedFile } from '@/lib/e2ee/client/files'
import type { AccountPrivateKey } from '@/lib/e2ee/types'
import { DEFAULT_PERMISSIONS } from '@/lib/permissions/catalog'

const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  uploadStream: vi.fn(),
  deleteFile: vi.fn(),
  finalize: vi.fn(),
}))
vi.mock('@/lib/http/access', () => ({ requireAccount: mocks.account }))
vi.mock('@/lib/security/rate-limit', () => ({
  rateLimit: async () => null,
  uploadLimiter: {},
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    user: {
      findUnique: async () => ({
        randomizeFileUrls: false,
        defaultFileExpiration: 'DISABLED',
        defaultFileExpirationAction: 'DELETE',
        defaultUploadProfileId: null,
      }),
    },
    file: { findFirst: async () => null },
  },
}))
vi.mock('@/lib/config', () => ({
  getConfig: async () => ({
    settings: {
      customization: { published: { sharing: { defaultStyle: 'framed' } } },
      general: {
        storage: {
          maxUploadSize: { value: 1, unit: 'MB' },
          quotas: { enabled: false, default: { value: 1, unit: 'MB' } },
        },
      },
    },
  }),
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => ({
    uploadStream: mocks.uploadStream,
    deleteFile: mocks.deleteFile,
  }),
}))
vi.mock('@/lib/uploads/finalize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/uploads/finalize')>()),
  finalizeUpload: mocks.finalize,
}))

const account = accountKeysFromPrivateKey(
  Uint8Array.from({ length: 32 }, (_, i) => i + 21) as AccountPrivateKey
)
const created = newEncryptedFile({
  name: 'love-letter.txt',
  type: 'text/plain',
  accountPublicKey: account.accountPublicKey,
})
const ciphertext = new Uint8Array(storedLengthOf(64))
ciphertext.set(base64urlDecode(created.records.header))

const user: AuthenticatedUser = {
  id: 'owner',
  storageUsed: 0,
  urlId: 'owner',
  vanityId: null,
  roles: [],
  permissions: [...DEFAULT_PERMISSIONS],
  randomizeFileUrls: false,
  credential: 'session',
}

async function send({
  fields = created.records as Record<string, string>,
  headers = { 'X-Flare-Encrypted': 'true' } as Record<string, string>,
  partName = 'encrypted',
  partType = 'application/octet-stream',
} = {}) {
  const form = new FormData()
  for (const [name, value] of Object.entries(fields)) form.set(name, value)
  form.set('file', new Blob([ciphertext], { type: partType }), partName)
  const encoded = new Response(form)
  return upload(
    new Request('https://flare.test/api/files', {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': encoded.headers.get('content-type')!,
      },
      body: new Uint8Array(await encoded.arrayBuffer()),
    })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.account.mockResolvedValue(user)
  mocks.uploadStream.mockImplementation(async (stream: Readable) => {
    let size = 0
    for await (const chunk of stream) size += (chunk as Buffer).length
    return { size }
  })
  mocks.finalize.mockImplementation(async (input) => ({
    id: 'file-1',
    urlPath: input.urlPath,
    name: input.displayName,
    mimeType: input.mimeType,
    size: input.size / 1024 ** 2,
    encrypted: Boolean(input.encrypted),
  }))
})

describe('an encrypted upload in one request', () => {
  it('stores the bytes under a random ID and publishes them with their records', async () => {
    const response = await send()
    expect(response.status).toBe(200)
    const [, storedPath, storedType] = mocks.uploadStream.mock.calls[0]
    expect(storedPath).toMatch(
      /^uploads\/owner\/[0-9a-f-]{36}\/e_[A-Za-z0-9_-]{22}$/
    )
    expect(storedType).toBe('application/octet-stream')
    const input = mocks.finalize.mock.calls[0][0]
    expect(input).toMatchObject({
      displayName: '',
      mimeType: 'application/octet-stream',
      size: ciphertext.length,
      isPaste: false,
    })
    expect(input.urlPath).toMatch(/^\/owner\/e_[A-Za-z0-9_-]{22}$/)
    expect(input.encrypted.header).toEqual(
      Uint8Array.from(base64urlDecode(created.records.header))
    )
    expect(input.encrypted.accountStanza).toHaveLength(97)
    const { data } = await response.json()
    expect(data).toEqual({
      encrypted: true,
      id: 'file-1',
      url: expect.stringMatching(/\/owner\/e_[A-Za-z0-9_-]{22}$/),
      pageUrl: expect.stringMatching(/\/owner\/e_[A-Za-z0-9_-]{22}$/),
      size: ciphertext.length,
    })
  })

  it('refuses a token: uploads with a token are plain in this release', async () => {
    for (const credential of ['upload-token', 'token'] as const) {
      mocks.account.mockResolvedValue({ ...user, credential })
      const response = await send()
      expect(response.status, credential).toBe(403)
    }
    expect(mocks.uploadStream).not.toHaveBeenCalled()
    expect(mocks.finalize).not.toHaveBeenCalled()
  })

  it('refuses a file part that carries a real name or type', async () => {
    for (const part of [
      { partName: 'love-letter.txt' },
      { partType: 'text/plain' },
    ]) {
      const response = await send(part)
      expect(response.status).toBe(400)
      expect((await response.json()).error).toMatch(/names its file part/)
    }
    expect(mocks.uploadStream).not.toHaveBeenCalled()
    expect(mocks.finalize).not.toHaveBeenCalled()
  })

  it('refuses a plaintext name, a server password or a missing record, and removes the stored bytes', async () => {
    const attempts: Record<string, string>[] = [
      { ...created.records, name: 'love-letter.txt' },
      { ...created.records, filename: 'love-letter.txt' },
      { ...created.records, mimeType: 'text/plain' },
      { ...created.records, password: 'server-password' },
      { header: created.records.header },
      {},
    ]
    for (const fields of attempts) {
      const response = await send({ fields })
      expect(response.status, Object.keys(fields).join()).toBe(400)
    }
    expect(mocks.finalize).not.toHaveBeenCalled()
    expect(mocks.deleteFile).toHaveBeenCalledTimes(6)
  })

  it('treats the same request without the header as a plain upload, whose finalize refuses ciphertext', async () => {
    const response = await send({ headers: {} })
    // The plain path keeps the part's name; the magic check is in finalize.
    expect(response.status).toBe(200)
    expect(mocks.finalize.mock.calls[0][0]).toMatchObject({
      displayName: 'encrypted',
      encrypted: null,
    })
  })

  it('marks an encrypted paste', async () => {
    await send({
      headers: { 'X-Flare-Encrypted': 'true', 'X-Flare-Paste': 'true' },
    })
    expect(mocks.finalize.mock.calls[0][0]).toMatchObject({ isPaste: true })
  })
})
