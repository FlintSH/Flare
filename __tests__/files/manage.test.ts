import { compare } from 'bcryptjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type AuditInput, configureAuditWriter } from '@/lib/audit'
import { type AuditContext, auditContext } from '@/lib/audit/context'
import {
  type FileAuthority,
  deleteFile,
  listAccountFiles,
  updateFileSettings,
} from '@/lib/files/manage'
import { loggers } from '@/lib/logger'

const mocks = vi.hoisted(() => {
  const tx = { file: { delete: vi.fn() }, user: { update: vi.fn() } }
  return {
    tx,
    file: {
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    removeBytes: vi.fn(),
  }
})
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    file: mocks.file,
    $transaction: async (run: (client: typeof mocks.tx) => unknown) =>
      run(mocks.tx),
  },
}))
vi.mock('@/lib/storage', () => ({
  getStorageProvider: async () => ({ deleteFile: mocks.removeBytes }),
}))

const files = mocks.file
const owner: FileAuthority = { as: 'owner', userId: 'owner' }
const moderator: FileAuthority = { as: 'moderator', accountId: 'owner' }
const found = {
  id: 'file-one',
  name: 'meeting-notes.txt',
  userId: 'owner',
  path: 'owner/meeting-notes.txt',
  size: 12,
}
const stored = {
  id: 'file-one',
  name: 'meeting-notes.txt',
  urlPath: '/aB3x9/meeting-notes.txt',
  mimeType: 'text/plain',
  size: 12,
  visibility: 'PRIVATE',
  uploadedAt: new Date('2026-09-20T12:00:00.000Z'),
  userId: 'owner',
  path: 'owner/meeting-notes.txt',
  password: '$2b$10$stored-hash',
  views: 3,
}
const events: Partial<AuditInput>[] = []

beforeEach(() => {
  vi.resetAllMocks()
  events.length = 0
  configureAuditWriter(async (event) => {
    events.push(event as Partial<AuditInput>)
  })
  files.findUnique.mockResolvedValue(found)
  files.update.mockResolvedValue(stored)
})

describe('changing file settings', () => {
  it("refuses the owner's session another account's file without changing it", async () => {
    files.findUnique.mockResolvedValue({ ...found, userId: 'someone-else' })
    await expect(
      updateFileSettings(owner, 'file-one', { visibility: 'PUBLIC' })
    ).rejects.toMatchObject({ status: 401, message: 'Unauthorized' })
    expect(files.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'file-one' } })
    )
    expect(files.update).not.toHaveBeenCalled()
  })

  it.each([
    ['its owner', owner, { id: 'file-one' }],
    ['a moderator', moderator, { id: 'file-one', userId: 'owner' }],
  ])(
    'reports a missing file to %s as 404',
    async (_actor, authority, where) => {
      files.findUnique.mockResolvedValue(null)
      await expect(
        updateFileSettings(authority, 'file-one', { visibility: 'PUBLIC' })
      ).rejects.toMatchObject({ status: 404, message: 'File not found' })
      expect(files.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where })
      )
      expect(files.update).not.toHaveBeenCalled()
    }
  )

  it('writes only the fields a request sends, hashing a new password', async () => {
    await updateFileSettings(owner, 'file-one', { visibility: 'PRIVATE' })
    expect(files.update).toHaveBeenLastCalledWith({
      where: { id: 'file-one' },
      data: { visibility: 'PRIVATE' },
    })

    await updateFileSettings(owner, 'file-one', {
      password: 'correct horse battery',
    })
    const { data } = files.update.mock.lastCall![0]
    expect(Object.keys(data)).toEqual(['password'])
    expect(await compare('correct horse battery', data.password)).toBe(true)

    for (const password of ['', null]) {
      await updateFileSettings(owner, 'file-one', { password })
      expect(files.update).toHaveBeenLastCalledWith({
        where: { id: 'file-one' },
        data: { password: null },
      })
    }
  })

  it("changes a moderated file only through its owner's account", async () => {
    await updateFileSettings(moderator, 'file-one', { visibility: 'PUBLIC' })
    expect(files.update).toHaveBeenCalledWith({
      where: { id: 'file-one', userId: 'owner' },
      data: { visibility: 'PUBLIC' },
    })
  })

  it('answers the whole stored file with hasPassword in place of the hash', async () => {
    const { password: _hash, ...metadata } = stored
    const answer = await updateFileSettings(owner, 'file-one', {})
    expect(answer).toEqual({ ...metadata, hasPassword: true })
    expect(Object.keys(answer)).toEqual([
      ...Object.keys(metadata),
      'hasPassword',
    ])
    files.update.mockResolvedValue({ ...stored, password: null })
    expect((await updateFileSettings(owner, 'file-one', {})).hasPassword).toBe(
      false
    )
  })
})

describe('deleting a file', () => {
  const remove = (authority: FileAuthority) => {
    const request: AuditContext = {}
    return auditContext
      .run(request, () => deleteFile(authority, 'file-one'))
      .then(() => request)
  }

  it.each([
    ['its owner', owner, { id: 'file-one' }],
    ['a moderator', moderator, { id: 'file-one', userId: 'owner' }],
  ])(
    'lets %s remove the bytes, the record and its storage use',
    async (_actor, authority, where) => {
      const request = await remove(authority)
      expect(files.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where })
      )
      expect(mocks.removeBytes).toHaveBeenCalledWith('owner/meeting-notes.txt')
      expect(mocks.tx.file.delete).toHaveBeenCalledWith({ where })
      expect(mocks.tx.user.update).toHaveBeenCalledWith({
        where: { id: 'owner' },
        data: { storageUsed: { decrement: 12 } },
      })
      expect(request).toMatchObject({
        targetType: 'file',
        targetId: 'file-one',
        targetName: 'meeting-notes.txt',
      })
      expect(events).toEqual([
        expect.objectContaining({
          action: 'storage.deleted',
          category: 'storage',
          outcome: 'success',
          targetId: 'file-one',
          targetName: 'meeting-notes.txt',
        }),
      ])
    }
  )

  it('deletes the record anyway when storage fails, and records why', async () => {
    const logged = vi.spyOn(loggers.files, 'error').mockImplementation(() => {})
    const failure = new Error('bucket unreachable')
    mocks.removeBytes.mockRejectedValue(failure)
    await remove(moderator)
    expect(events).toEqual([
      expect.objectContaining({
        action: 'storage.delete_failed',
        outcome: 'failure',
        targetId: 'file-one',
        details: expect.objectContaining({
          reason: 'Storage deletion failed; file metadata deletion continues',
          ownerId: 'owner',
        }),
      }),
    ])
    expect(logged).toHaveBeenCalledWith(
      'Error deleting file from storage',
      failure,
      { fileId: 'file-one', filePath: 'owner/meeting-notes.txt' }
    )
    expect(mocks.tx.file.delete).toHaveBeenCalledOnce()
    expect(mocks.tx.user.update).toHaveBeenCalledOnce()
  })

  it.each([
    ['a missing file', null, owner, 404],
    ['a missing or foreign moderated file', null, moderator, 404],
    ["another account's file", { ...found, userId: 'other' }, owner, 401],
  ])(
    'touches neither storage nor the record for %s',
    async (_case, file, authority, status) => {
      files.findUnique.mockResolvedValue(file)
      await expect(deleteFile(authority, 'file-one')).rejects.toMatchObject({
        status,
      })
      expect(mocks.removeBytes).not.toHaveBeenCalled()
      expect(mocks.tx.file.delete).not.toHaveBeenCalled()
      expect(events).toEqual([])
    }
  )
})

describe("listing an account's files for moderators", () => {
  const query = {
    page: 1,
    limit: 10,
    search: '',
    visibility: '',
    type: '',
  }

  it.each([Number.NaN, 0, -2, 1.5, Number.MAX_SAFE_INTEGER + 2])(
    'uses page 1 and 10 files for a page or limit of %s',
    async (value) => {
      files.count.mockResolvedValue(30)
      files.findMany.mockResolvedValue([])
      expect(
        (
          await listAccountFiles('member', {
            ...query,
            page: value,
            limit: value,
          })
        ).pagination
      ).toEqual({ total: 30, pages: 3, page: 1, limit: 10 })
      expect(files.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 })
      )
    }
  )

  it('caps the limit at 100 and the page at the last one', async () => {
    files.count.mockResolvedValue(250)
    files.findMany.mockResolvedValue([])
    expect(
      (await listAccountFiles('member', { ...query, page: 9, limit: 500 }))
        .pagination
    ).toEqual({ total: 250, pages: 3, page: 3, limit: 100 })
    expect(files.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 200, take: 100 })
    )
  })

  it('answers an account without files with page 1 of 0', async () => {
    files.count.mockResolvedValue(0)
    files.findMany.mockResolvedValue([])
    expect(await listAccountFiles('member', { ...query, page: 4 })).toEqual({
      files: [],
      pagination: { total: 0, pages: 0, page: 1, limit: 10 },
    })
  })

  it('filters by text, visibility in any letter case, and type prefix, newest first', async () => {
    files.count.mockResolvedValue(0)
    files.findMany.mockResolvedValue([])
    await listAccountFiles('member', {
      ...query,
      search: 'Notes',
      visibility: 'Private',
      type: 'image/',
    })
    const where = {
      userId: 'member',
      OR: [
        { name: { contains: 'Notes', mode: 'insensitive' } },
        { ocrText: { contains: 'Notes', mode: 'insensitive' } },
      ],
      visibility: 'PRIVATE',
      mimeType: { startsWith: 'image/' },
    }
    expect(files.count).toHaveBeenCalledWith({ where })
    expect(files.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where, orderBy: { uploadedAt: 'desc' } })
    )
    await listAccountFiles('member', query)
    expect(files.count).toHaveBeenLastCalledWith({
      where: { userId: 'member' },
    })
  })

  it.each(['PROTECTED', 'hasPassword', 'PUBLIC,PRIVATE', 'hidden'])(
    'refuses the visibility %s before reading anything',
    async (visibility) => {
      await expect(
        listAccountFiles('member', { ...query, visibility })
      ).rejects.toMatchObject({
        status: 400,
        message: 'visibility must be public or private',
      })
      expect(files.count).not.toHaveBeenCalled()
      expect(files.findMany).not.toHaveBeenCalled()
    }
  )

  it('reports a password-protected file as PROTECTED and never sends its hash', async () => {
    const row = {
      id: 'file-one',
      name: 'meeting-notes.txt',
      mimeType: 'text/plain',
      size: 12,
      visibility: 'PRIVATE',
      uploadedAt: stored.uploadedAt,
      urlPath: '/aB3x9/meeting-notes.txt',
      isPaste: false,
    }
    files.count.mockResolvedValue(2)
    files.findMany.mockResolvedValue([
      { ...row, password: '$2b$10$stored-hash' },
      { ...row, id: 'file-two', visibility: 'PUBLIC', password: null },
    ])
    const { files: listed } = await listAccountFiles('member', query)
    expect(listed).toEqual([
      { ...row, visibility: 'PROTECTED' },
      { ...row, id: 'file-two', visibility: 'PUBLIC' },
    ])
    expect(Object.keys(listed[0])).toEqual(Object.keys(row))
  })
})
