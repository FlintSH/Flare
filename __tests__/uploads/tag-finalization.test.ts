import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import { DEFAULT_PERMISSIONS } from '@/lib/permissions/catalog'
import type { StorageProvider } from '@/lib/storage'
import { finalizeUpload } from '@/lib/uploads/finalize'
import { mergeUploadOptions } from '@/lib/uploads/schema'

const mocks = vi.hoisted(() => ({
  quotas: { enabled: false, default: { value: 10, unit: 'GB' } },
  applyProfileTags: vi.fn(),
  applyAutomaticTags: vi.fn(),
  enqueueFileReady: vi.fn(),
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
        ocr: { enabled: true },
        storage: {
          maxUploadSize: { value: 10, unit: 'MB' },
          quotas: mocks.quotas,
        },
      },
    },
  }),
}))
vi.mock('@/lib/security/file-validation', () => ({
  validateFileType: async () => ({ valid: true }),
}))
vi.mock('@/lib/integrations/webhooks', () => ({
  enqueueFileReady: mocks.enqueueFileReady,
}))
vi.mock('@/lib/ocr', () => ({ ocrQueue: { add: vi.fn() } }))
vi.mock('@/lib/files/library-records', () => ({
  // The library records of an upload have their own suite.
  newFileLibraryState: async () => ({
    columns: {},
    sealed: null,
    ruleTagIds: [],
  }),
  applyRuleTags: async () => 0,
  storeSealedData: async () => {},
}))

const user: AuthenticatedUser = {
  id: 'alice',
  storageUsed: 0,
  urlId: 'alice',
  vanityId: null,
  roles: [],
  permissions: [...DEFAULT_PERMISSIONS],
  randomizeFileUrls: true,
  credential: 'session',
}
const file = {
  id: 'file-one',
  userId: 'alice',
  name: 'Invoice September.txt',
  path: 'uploads/alice/random.txt',
  mimeType: 'text/plain',
}
const input = () => ({
  user,
  storage: {
    kind: 'local',
    target: { provider: 'local' },
    getFileStream: async () => Readable.from([Buffer.from('invoice')]),
  } as unknown as StorageProvider,
  filePath: file.path,
  urlPath: '/alice/random.txt',
  displayName: file.name,
  mimeType: 'text/plain',
  size: 7,
  options: mergeUploadOptions({}, { tagIds: ['work'] }, {}),
})

beforeEach(() => {
  vi.resetAllMocks()
  mocks.quotas.enabled = false
  mocks.tx.config.findUnique.mockResolvedValue(null)
  mocks.tx.user.findUnique.mockResolvedValue(user)
  mocks.tx.role.findUnique.mockResolvedValue({
    id: 'everyone',
    name: 'Everyone',
    position: 0,
    systemKey: 'everyone',
    permissions: [...DEFAULT_PERMISSIONS],
  })
  mocks.tx.file.findFirst.mockResolvedValue(null)
  mocks.tx.file.findUnique.mockResolvedValue(null)
  mocks.tx.file.create.mockResolvedValue(file)
  mocks.transaction.mockImplementation((callback) => callback(mocks.tx))
})

describe('tags at the shared upload commit boundary', () => {
  it('publishes empty files without issuing an invalid S3 range request', async () => {
    const upload = input()
    const getFileStream = vi
      .fn()
      .mockRejectedValue(new Error('S3 range not satisfiable'))
    upload.size = 0
    upload.storage.getFileStream = getFileStream
    await finalizeUpload(upload)
    expect(getFileStream).not.toHaveBeenCalled()
    expect(mocks.tx.file.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ size: 0 }) })
    )
  })
  it('records the actual writing backend even when current configuration differs', async () => {
    const upload = input()
    upload.storage = {
      ...upload.storage,
      kind: 's3',
      target: {
        provider: 's3',
        bucket: 'original-upload-bucket',
        region: 'us-east-1',
        endpoint: 'https://objects.example.test',
        forcePathStyle: true,
      },
    }
    await finalizeUpload(upload)
    expect(mocks.tx.file.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ storageTarget: upload.storage.target }),
      })
    )
  })

  it('rechecks folder ownership under the user lock before publishing direct and chunk uploads', async () => {
    mocks.tx.vaultFolder.findFirst.mockResolvedValue({ id: 'marketing' })
    const upload = input()
    upload.options.folderId = 'marketing'
    await finalizeUpload({ ...upload, transaction: mocks.tx as never })
    expect(mocks.tx.vaultFolder.findFirst).toHaveBeenCalledWith({
      where: { id: 'marketing', userId: user.id },
      select: { id: true },
    })
    expect(mocks.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.tx.vaultFolder.findFirst.mock.invocationCallOrder[0]
    )
    expect(mocks.tx.file.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ folderId: 'marketing' }),
      })
    )
    mocks.tx.file.create.mockClear()
    mocks.tx.vaultFolder.findFirst.mockResolvedValue(null)
    await expect(finalizeUpload(upload)).rejects.toMatchObject({ status: 404 })
    expect(mocks.tx.file.create).not.toHaveBeenCalled()
  })

  it('publishes profile tags and filename matches in the file transaction using the original name', async () => {
    await finalizeUpload(input())
    expect(mocks.tx.file.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Invoice September.txt',
          urlPath: '/alice/random.txt',
        }),
      })
    )
    expect(mocks.applyProfileTags).toHaveBeenCalledWith(mocks.tx, file, [
      'work',
    ])
    expect(mocks.applyAutomaticTags).toHaveBeenCalledWith(
      file.id,
      'filename',
      mocks.tx
    )
    expect(mocks.applyAutomaticTags.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.enqueueFileReady.mock.invocationCallOrder[0]
    )
  })

  it('uses the existing chunk assembly transaction without opening another transaction', async () => {
    await finalizeUpload({ ...input(), transaction: mocks.tx as never })
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.applyProfileTags).toHaveBeenCalledWith(mocks.tx, file, [
      'work',
    ])
    expect(mocks.applyAutomaticTags).toHaveBeenCalledWith(
      file.id,
      'filename',
      mocks.tx
    )
  })

  it('fails the commit if a selected tag was deleted or belongs to another account', async () => {
    mocks.applyProfileTags.mockRejectedValue(
      new Error('One or more tags are unavailable.')
    )
    await expect(finalizeUpload(input())).rejects.toThrow('unavailable')
    expect(mocks.tx.user.update).not.toHaveBeenCalled()
    expect(mocks.enqueueFileReady).not.toHaveBeenCalled()
  })

  it('does not reapply tags when a completed upload is retried', async () => {
    mocks.tx.file.findFirst.mockResolvedValue(file)
    await expect(finalizeUpload(input())).resolves.toEqual(file)
    expect(mocks.applyProfileTags).not.toHaveBeenCalled()
    expect(mocks.applyAutomaticTags).not.toHaveBeenCalled()
  })
  it('rejects revoked upload permissions after the settings and access locks, despite stale caller authority', async () => {
    mocks.tx.role.findUnique.mockResolvedValue({
      id: 'everyone',
      name: 'Everyone',
      position: 0,
      systemKey: 'everyone',
      permissions: ['files.read'],
    })
    await expect(finalizeUpload(input())).rejects.toMatchObject({ status: 403 })
    expect(mocks.tx.$executeRaw.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.tx.role.findUnique.mock.invocationCallOrder[0]
    )
    expect(mocks.tx.file.create).not.toHaveBeenCalled()
  })

  it('requires paste, folder, and tag grants independently at commit time', async () => {
    mocks.tx.role.findUnique.mockResolvedValue({
      id: 'everyone',
      name: 'Everyone',
      position: 0,
      systemKey: 'everyone',
      permissions: ['files.upload'],
    })
    for (const upload of [
      { ...input(), isPaste: true },
      {
        ...input(),
        options: mergeUploadOptions({}, {}, { folderId: 'marketing' }),
      },
      input(),
    ])
      await expect(finalizeUpload(upload)).rejects.toMatchObject({
        status: 403,
      })
    expect(mocks.tx.file.create).not.toHaveBeenCalled()
  })

  it('forces new files private when the current role cannot share', async () => {
    mocks.tx.role.findUnique.mockResolvedValue({
      id: 'everyone',
      name: 'Everyone',
      position: 0,
      systemKey: 'everyone',
      permissions: ['files.upload'],
    })
    await finalizeUpload({
      ...input(),
      options: mergeUploadOptions({}, {}, { visibility: 'PUBLIC' }),
    })
    expect(mocks.tx.file.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ visibility: 'PRIVATE' }),
      })
    )
  })
})

describe('token-bound profiles at the upload commit', () => {
  it('refuses a token whose profile was removed, with its own answer and before writing', async () => {
    const token = {
      id: 'token',
      scopes: ['files:upload'],
      profileId: 'bound',
      predatesEncryption: false,
    }
    mocks.tx.apiToken.findUnique.mockResolvedValue({
      ...token,
      userId: 'alice',
      revokedAt: null,
      expiresAt: null,
    })
    mocks.tx.uploadProfile.findFirst.mockResolvedValue(null)
    const upload = { ...input(), user: { ...user, apiToken: token } }
    upload.options.profileId = 'bound'
    await expect(finalizeUpload(upload)).rejects.toMatchObject({
      name: 'UploadError',
      status: 403,
      message: 'The token upload profile was removed.',
    })
    expect(mocks.tx.uploadProfile.findFirst).toHaveBeenCalledWith({
      where: { id: 'bound', userId: 'alice' },
    })
    expect(mocks.tx.file.create).not.toHaveBeenCalled()
  })
})

describe('limits at the upload commit', () => {
  it('refuses a file over the size limit or the quota left, before writing', async () => {
    const large = input()
    large.size = 10 * 1024 ** 2 + 1
    await expect(finalizeUpload(large)).rejects.toMatchObject({
      status: 413,
      message: 'A file exceeds the upload size limit.',
    })
    mocks.quotas.enabled = true
    mocks.tx.user.findUnique.mockResolvedValue({
      ...user,
      storageUsed: 10 * 1024 - 0.5,
    })
    const over = input()
    over.size = 1024 ** 2 / 2 + 1
    await expect(finalizeUpload(over)).rejects.toMatchObject({
      status: 413,
      message: 'This would exceed your storage quota.',
    })
    expect(mocks.tx.file.create).not.toHaveBeenCalled()
    await finalizeUpload({ ...over, size: 1024 ** 2 / 2 })
    expect(mocks.tx.file.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ size: 0.5 }) })
    )
  })
})
