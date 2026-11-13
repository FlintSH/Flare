import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createFolder,
  deleteFolder,
  insertFolder,
  listFolders,
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
    delete: vi.fn(),
  },
  file: { count: vi.fn(), groupBy: vi.fn(), updateMany: vi.fn() },
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

describe('an account’s folder list', () => {
  const stored = (
    id: string,
    name: string,
    parentId: string | null = null
  ) => ({
    id,
    name,
    parentId,
    shareToken: null,
  })

  it('counts each folder’s files, and nothing for a folder without any', async () => {
    mocks.vaultFolder.findMany.mockResolvedValue([
      stored('archive', 'Archive'),
      stored('empty', 'Empty'),
      stored('photos', 'Photos', 'archive'),
    ])
    // Only folders that hold files have a group.
    mocks.file.groupBy.mockResolvedValue([
      { folderId: 'photos', _count: { _all: 4 } },
      { folderId: 'archive', _count: { _all: 1 } },
    ])
    expect(await listFolders('owner')).toEqual([
      { ...stored('archive', 'Archive'), fileCount: 1 },
      { ...stored('empty', 'Empty'), fileCount: 0 },
      { ...stored('photos', 'Photos', 'archive'), fileCount: 4 },
    ])
  })

  it('reads the folders and the counts for the owner alone, in name order', async () => {
    mocks.vaultFolder.findMany.mockResolvedValue([])
    mocks.file.groupBy.mockResolvedValue([])
    expect(await listFolders('owner')).toEqual([])
    expect(mocks.vaultFolder.findMany).toHaveBeenCalledWith({
      where: { userId: 'owner' },
      orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, parentId: true, shareToken: true },
    })
    expect(mocks.file.groupBy).toHaveBeenCalledWith({
      by: ['folderId'],
      where: { userId: 'owner', folderId: { not: null } },
      _count: { _all: true },
    })
  })

  it('leaves out a count whose folder is not in the list', async () => {
    mocks.vaultFolder.findMany.mockResolvedValue([stored('photos', 'Photos')])
    mocks.file.groupBy.mockResolvedValue([
      { folderId: 'deleted-meanwhile', _count: { _all: 9 } },
    ])
    expect(await listFolders('owner')).toEqual([
      { ...stored('photos', 'Photos'), fileCount: 0 },
    ])
  })
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

  it('creates folders with the case-insensitive key and only the fields a caller selects', async () => {
    const tx = {
      vaultFolder: { create: vi.fn().mockResolvedValue({ id: 'created' }) },
    }
    await expect(
      insertFolder(
        tx as never,
        'owner',
        { name: 'Week 1', parentId: 'folder' },
        { id: true }
      )
    ).resolves.toEqual({ id: 'created' })
    expect(tx.vaultFolder.create).toHaveBeenCalledWith({
      data: {
        userId: 'owner',
        name: 'Week 1',
        normalizedName: 'week 1',
        parentId: 'folder',
      },
      select: { id: true },
    })
    expect(mocks.vaultFolder.create).not.toHaveBeenCalled()
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
