import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createFolder,
  deleteFolder,
  moveFilesToFolder,
  updateFolder,
  validateOwnedFolderId,
} from '@/lib/folders/service'

const mocks = vi.hoisted(() => ({
  vaultFolder: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  },
  file: { count: vi.fn(), updateMany: vi.fn() },
  $queryRaw: vi.fn(),
  transaction: vi.fn(),
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { ...mocks, $transaction: mocks.transaction },
}))

const folder = {
  id: 'folder',
  name: 'Photos',
  parentId: null,
  shareToken: null,
  _count: { files: 2 },
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.transaction.mockImplementation((callback) => callback(mocks))
  mocks.vaultFolder.findFirst.mockResolvedValue(folder)
  mocks.vaultFolder.findMany.mockResolvedValue([])
  mocks.vaultFolder.create.mockImplementation(({ data }) => ({
    ...folder,
    ...data,
  }))
  mocks.vaultFolder.update.mockImplementation(({ data }) => ({
    ...folder,
    ...data,
  }))
  mocks.file.count.mockResolvedValue(1)
  mocks.file.updateMany.mockResolvedValue({ count: 1 })
})

describe('owner-isolated folder mutations', () => {
  it('validates the parent inside the owner lock before creating a private folder', async () => {
    expect(
      await createFolder('owner', { name: 'Week 1', parentId: 'folder' })
    ).toEqual({
      id: 'folder',
      name: 'Week 1',
      parentId: 'folder',
      shareToken: null,
      fileCount: 2,
    })
    expect(mocks.vaultFolder.findFirst).toHaveBeenCalledWith({
      where: { id: 'folder', userId: 'owner' },
      select: { id: true },
    })
    expect(mocks.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.vaultFolder.findFirst.mock.invocationCallOrder[0]
    )
    mocks.vaultFolder.findFirst.mockResolvedValue(null)
    await expect(
      createFolder('admin', { name: 'Week 2', parentId: 'foreign' })
    ).rejects.toMatchObject({ status: 404 })
    expect(mocks.vaultFolder.create).toHaveBeenCalledTimes(1)
  })

  it('validates upload destinations using the supplied transaction', async () => {
    const tx = {
      vaultFolder: { findFirst: vi.fn().mockResolvedValue({ id: 'own' }) },
    }
    await expect(
      validateOwnedFolderId('owner', 'own', tx as never)
    ).resolves.toBe('own')
    await expect(
      validateOwnedFolderId('owner', null, tx as never)
    ).resolves.toBeNull()
    expect(tx.vaultFolder.findFirst).toHaveBeenCalledTimes(1)
    expect(mocks.vaultFolder.findFirst).not.toHaveBeenCalled()
  })

  it('rejects foreign folders before checking files, without revealing their existence', async () => {
    mocks.vaultFolder.findFirst.mockResolvedValue(null)
    await expect(
      moveFilesToFolder('owner', { fileIds: ['file'], folderId: 'foreign' })
    ).rejects.toMatchObject({ status: 404, message: 'Folder not found.' })
    expect(mocks.file.count).not.toHaveBeenCalled()
    expect(mocks.file.updateMany).not.toHaveBeenCalled()
  })

  it('rejects a mixed-owner selection atomically before changing any file', async () => {
    await expect(
      moveFilesToFolder('owner', {
        fileIds: ['own', 'foreign'],
        folderId: 'folder',
      })
    ).rejects.toMatchObject({ status: 404 })
    expect(mocks.file.count).toHaveBeenCalledWith({
      where: { userId: 'owner', id: { in: ['own', 'foreign'] } },
    })
    expect(mocks.file.updateMany).not.toHaveBeenCalled()
  })

  it('deduplicates moves and changes only folder membership, including moving back to unfiled', async () => {
    for (const folderId of ['folder', null]) {
      expect(
        await moveFilesToFolder('owner', {
          fileIds: ['file', 'file'],
          folderId,
        })
      ).toBe(1)
      expect(mocks.file.updateMany).toHaveBeenLastCalledWith({
        where: { userId: 'owner', id: { in: ['file'] } },
        data: { folderId },
      })
    }
  })

  it('rolls back a move if a selected file disappears after the ownership check', async () => {
    mocks.file.updateMany.mockResolvedValue({ count: 0 })
    await expect(
      moveFilesToFolder('owner', { fileIds: ['file'], folderId: null })
    ).rejects.toMatchObject({ status: 404 })
  })

  it('gives foreign-folder rename, sharing, and deletion the same not-found result', async () => {
    mocks.vaultFolder.findFirst.mockResolvedValue(null)
    await expect(
      updateFolder('admin', 'foreign', { name: 'Renamed', sharing: true })
    ).rejects.toMatchObject({ status: 404, message: 'Folder not found.' })
    await expect(deleteFolder('admin', 'foreign')).rejects.toMatchObject({
      status: 404,
      message: 'Folder not found.',
    })
    expect(mocks.vaultFolder.update).not.toHaveBeenCalled()
    expect(mocks.vaultFolder.delete).not.toHaveBeenCalled()
  })

  it('preserves a live share link and rotates it after revocation', async () => {
    const first = await updateFolder('owner', 'folder', { sharing: true })
    expect(first.shareToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    mocks.vaultFolder.findFirst.mockResolvedValue({
      ...folder,
      shareToken: first.shareToken,
    })
    expect(
      (await updateFolder('owner', 'folder', { sharing: true })).shareToken
    ).toBe(first.shareToken)
    expect(
      (await updateFolder('owner', 'folder', { sharing: false })).shareToken
    ).toBeNull()
    mocks.vaultFolder.findFirst.mockResolvedValue(folder)
    expect(
      (await updateFolder('owner', 'folder', { sharing: true })).shareToken
    ).not.toBe(first.shareToken)
  })

  it('renames without changing sharing, files, or hierarchy', async () => {
    await updateFolder('owner', 'folder', { name: 'Marketing' })
    expect(mocks.vaultFolder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'folder', userId: 'owner' },
        data: { name: 'Marketing', normalizedName: 'marketing' },
      })
    )
    expect(mocks.file.updateMany).not.toHaveBeenCalled()
  })
})

describe('dissolving folders safely', () => {
  it.each([null, 'grandparent'])(
    'moves direct contents to %s without deleting files',
    async (parentId) => {
      mocks.vaultFolder.findFirst
        .mockResolvedValueOnce({ ...folder, parentId })
        .mockResolvedValueOnce(null)
      mocks.vaultFolder.findMany.mockResolvedValue([
        { normalizedName: 'photos' },
      ])
      await deleteFolder('owner', 'folder')
      expect(mocks.vaultFolder.update).toHaveBeenCalledWith({
        where: { id: 'folder', userId: 'owner' },
        data: { normalizedName: '/deleted/folder' },
      })
      expect(mocks.vaultFolder.updateMany).toHaveBeenCalledWith({
        where: { userId: 'owner', parentId: 'folder' },
        data: { parentId },
      })
      expect(mocks.file.updateMany).toHaveBeenCalledWith({
        where: { userId: 'owner', folderId: 'folder' },
        data: { folderId: parentId },
      })
      expect(mocks.vaultFolder.delete).toHaveBeenCalledWith({
        where: { id: 'folder', userId: 'owner' },
      })
      expect(mocks.vaultFolder.update.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.vaultFolder.updateMany.mock.invocationCallOrder[0]
      )
      expect(
        mocks.vaultFolder.updateMany.mock.invocationCallOrder[0]
      ).toBeLessThan(mocks.vaultFolder.delete.mock.invocationCallOrder[0])
    }
  )

  it('rejects child/sibling name collisions before moving anything', async () => {
    mocks.vaultFolder.findMany.mockResolvedValue([{ normalizedName: 'week 1' }])
    mocks.vaultFolder.findFirst
      .mockResolvedValueOnce(folder)
      .mockResolvedValueOnce({ id: 'conflicting-sibling' })
    await expect(deleteFolder('owner', 'folder')).rejects.toMatchObject({
      status: 409,
    })
    expect(mocks.vaultFolder.findFirst).toHaveBeenLastCalledWith({
      where: {
        userId: 'owner',
        parentId: null,
        id: { not: 'folder' },
        normalizedName: { in: ['week 1'] },
      },
      select: { id: true },
    })
    expect(mocks.vaultFolder.update).not.toHaveBeenCalled()
    expect(mocks.vaultFolder.updateMany).not.toHaveBeenCalled()
    expect(mocks.file.updateMany).not.toHaveBeenCalled()
    expect(mocks.vaultFolder.delete).not.toHaveBeenCalled()
  })
})
