import { POST as upload } from '@/app/api/files/route'
import type { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import { loggers } from '@/lib/logger'
import { DEFAULT_PERMISSIONS } from '@/lib/permissions/catalog'

const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  quotas: { enabled: false, default: { value: 1, unit: 'MB' } },
  uploadStream: vi.fn(),
  deleteFile: vi.fn(),
  finalize: vi.fn(),
  findFile: vi.fn(),
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
    uploadProfile: {
      findFirst: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        options: {},
        updatedAt: new Date('2026-11-01T00:00:00.000Z'),
      }),
    },
    file: { findFirst: mocks.findFile },
  },
}))
vi.mock('@/lib/config', () => ({
  getConfig: async () => ({
    settings: {
      customization: { published: { sharing: { defaultStyle: 'framed' } } },
      general: {
        storage: {
          maxUploadSize: { value: 1, unit: 'MB' },
          quotas: mocks.quotas,
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

const user: AuthenticatedUser = {
  id: 'owner',
  storageUsed: 0,
  urlId: 'owner',
  vanityId: null,
  roles: [],
  permissions: [...DEFAULT_PERMISSIONS],
  randomizeFileUrls: false,
  credential: 'upload-token',
}

async function send(
  fields: Record<string, string> = {},
  headers: Record<string, string> = {},
  bytes = 'screenshot'
) {
  const form = new FormData()
  form.set('file', new Blob([bytes], { type: 'text/plain' }), 'shot.txt')
  for (const [name, value] of Object.entries(fields)) form.set(name, value)
  // A buffered body: a FormData stream fails noisily when the upload stops reading it.
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
  mocks.quotas.enabled = false
  mocks.account.mockResolvedValue(user)
  mocks.findFile.mockResolvedValue(null)
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
  }))
})

describe('direct uploads', () => {
  it('stores the file under the options its headers chose', async () => {
    const response = await send(
      { profileId: 'work' },
      { 'X-Upload-Profile': 'work' }
    )
    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({
      name: 'shot.txt',
      size: 10,
    })
    expect(mocks.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        size: 10,
        isPaste: false,
        options: expect.objectContaining({ profileId: 'work' }),
      })
    )
  })

  it('answers a profile or naming change in the form as chunk completion does, without logging it', async () => {
    const logged = vi.spyOn(loggers.files, 'error')
    const profile = await send({ profileId: 'other' })
    expect(profile.status).toBe(403)
    expect(await profile.json()).toEqual({
      error: 'The upload profile cannot change after upload starts.',
    })
    const naming = await send({ randomizeFileUrls: 'true' })
    expect(naming.status).toBe(400)
    expect(await naming.json()).toEqual({
      error: 'The naming strategy cannot change after upload starts.',
    })
    expect(mocks.finalize).not.toHaveBeenCalled()
    // The stored bytes of each refused upload are removed again.
    expect(mocks.deleteFile).toHaveBeenCalledTimes(2)
    expect(logged).not.toHaveBeenCalled()
  })

  it('refuses a file over the size limit or the quota left with one message each', async () => {
    const large = await send({}, {}, 'x'.repeat(1024 ** 2 + 1))
    expect(large.status).toBe(413)
    expect(await large.json()).toEqual({
      error: 'A file exceeds the upload size limit.',
    })
    mocks.quotas.enabled = true
    mocks.account.mockResolvedValue({ ...user, storageUsed: 0.5 })
    const over = await send({}, {}, 'x'.repeat(1024 ** 2 / 2 + 1))
    expect(over.status).toBe(413)
    expect(await over.json()).toEqual({
      error: 'This would exceed your storage quota.',
    })
    mocks.uploadStream.mockClear()
    mocks.account.mockResolvedValue({ ...user, storageUsed: 1 })
    const full = await send()
    expect(full.status).toBe(413)
    expect(await full.json()).toEqual({
      error: 'This would exceed your storage quota.',
    })
    expect(mocks.uploadStream).not.toHaveBeenCalled()
    expect(mocks.finalize).not.toHaveBeenCalled()
  })

  it('refuses pastes to roles that cannot create them', async () => {
    mocks.account.mockResolvedValue({
      ...user,
      permissions: DEFAULT_PERMISSIONS.filter(
        (permission) => permission !== 'pastes.create'
      ),
    })
    const response = await send({}, { 'X-Flare-Paste': 'true' })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'You do not have permission to create pastes.',
    })
  })
})
