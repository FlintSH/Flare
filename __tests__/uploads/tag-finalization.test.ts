import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthenticatedUser } from '@/lib/auth/api-auth'
import type { StorageProvider } from '@/lib/storage'
import { finalizeUpload } from '@/lib/uploads/finalize'
import { mergeUploadOptions } from '@/lib/uploads/schema'

const mocks = vi.hoisted(() => ({
  applyProfileTags: vi.fn(),
  applyAutomaticTags: vi.fn(),
  enqueueFileReady: vi.fn(),
  transaction: vi.fn(),
  tx: {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    config: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    file: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    vaultFolder: { findFirst: vi.fn() },
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
  DEFAULT_CONFIG: {
    settings: {
      general: {
        storage: {
          maxUploadSize: { value: 10, unit: 'MB' },
          quotas: { enabled: false, default: { value: 10, unit: 'GB' } },
        },
      },
    },
  },
  configSchema: { parse: (value: unknown) => value },
}))
vi.mock('@/lib/security/file-validation', () => ({
  validateFileType: async () => ({ valid: true }),
}))
vi.mock('@/lib/integrations/webhooks', () => ({
  enqueueFileReady: mocks.enqueueFileReady,
}))
vi.mock('@/lib/ocr', () => ({ ocrQueue: { add: vi.fn() } }))

const user: AuthenticatedUser = {
  id: 'alice',
  storageUsed: 0,
  urlId: 'alice',
  vanityId: null,
  role: 'USER',
  randomizeFileUrls: true,
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
  mocks.tx.config.findUnique.mockResolvedValue(null)
  mocks.tx.user.findUnique.mockResolvedValue(user)
  mocks.tx.file.findFirst.mockResolvedValue(null)
  mocks.tx.file.findUnique.mockResolvedValue(null)
  mocks.tx.file.create.mockResolvedValue(file)
  mocks.transaction.mockImplementation((callback) => callback(mocks.tx))
})

describe('tags at the shared upload commit boundary', () => {
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
})
