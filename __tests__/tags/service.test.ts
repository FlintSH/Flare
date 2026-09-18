import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyAutomaticTags,
  applyProfileTags,
  applyTagToExistingFiles,
  changeFileTags,
  validateOwnedTagIds,
} from '@/lib/tags/service'

const mocks = vi.hoisted(() => ({
  file: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  vaultTag: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  vaultFileTag: { createMany: vi.fn(), updateMany: vi.fn() },
  transaction: vi.fn(),
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { ...mocks, $transaction: mocks.transaction },
}))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.transaction.mockImplementation((callback) => callback(mocks))
  mocks.vaultTag.findFirst.mockResolvedValue({
    id: 'tag-work',
    ruleSource: 'filename',
    ruleText: 'invoice',
  })
  mocks.vaultFileTag.createMany.mockResolvedValue({ count: 1 })
  mocks.file.findUnique.mockResolvedValue({
    id: 'file-one',
    userId: 'owner',
    name: 'Invoice.png',
    ocrText: 'Receipt from Acme',
  })
})

describe('tag ownership and automatic assignment', () => {
  it('rejects a mixed-ownership bulk action before writing any associations', async () => {
    mocks.file.count.mockResolvedValue(1)
    await expect(
      changeFileTags('owner', {
        fileIds: ['owned', 'foreign'],
        tagId: 'tag-work',
        action: 'add',
      })
    ).rejects.toMatchObject({ status: 404 })
    expect(mocks.vaultTag.findFirst).toHaveBeenCalledWith({
      where: { id: 'tag-work', userId: 'owner' },
      select: { id: true },
    })
    expect(mocks.file.count).toHaveBeenCalledWith({
      where: { id: { in: ['owned', 'foreign'] }, userId: 'owner' },
    })
    expect(mocks.vaultFileTag.createMany).not.toHaveBeenCalled()
    expect(mocks.vaultFileTag.updateMany).not.toHaveBeenCalled()
  })

  it('does not reveal whether another account owns a requested tag', async () => {
    mocks.vaultTag.findFirst.mockResolvedValue(null)
    await expect(
      changeFileTags('admin', {
        fileIds: ['owned'],
        tagId: 'foreign-tag',
        action: 'remove',
      })
    ).rejects.toMatchObject({ status: 404, message: 'Tag not found.' })
    expect(mocks.file.count).not.toHaveBeenCalled()
    expect(mocks.vaultFileTag.createMany).not.toHaveBeenCalled()
  })

  it('remembers removals, and explicit additions restore excluded tags', async () => {
    mocks.file.count.mockResolvedValue(1)
    for (const action of ['remove', 'add'] as const) {
      expect(
        await changeFileTags('owner', {
          fileIds: ['owned', 'owned'],
          tagId: 'tag-work',
          action,
        })
      ).toBe(1)
      expect(mocks.vaultFileTag.createMany).toHaveBeenLastCalledWith({
        data: [
          { fileId: 'owned', tagId: 'tag-work', excluded: action === 'remove' },
        ],
        skipDuplicates: true,
      })
      expect(mocks.vaultFileTag.updateMany).toHaveBeenLastCalledWith({
        where: { fileId: { in: ['owned'] }, tagId: 'tag-work' },
        data: { excluded: action === 'remove' },
      })
    }
  })

  it('matches only the owner and requested source, without reviving exclusions', async () => {
    mocks.vaultTag.findMany.mockResolvedValue([
      { id: 'matching', ruleText: 'iNvOiCe' },
      { id: 'other', ruleText: 'acme' },
    ])
    await expect(applyAutomaticTags('file-one', 'filename')).resolves.toBe(1)
    expect(mocks.vaultTag.findMany).toHaveBeenCalledWith({
      where: { userId: 'owner', ruleSource: 'filename' },
      select: { id: true, ruleText: true },
    })
    expect(mocks.vaultFileTag.createMany).toHaveBeenCalledWith({
      data: [{ fileId: 'file-one', tagId: 'matching' }],
      skipDuplicates: true,
    })
    expect(mocks.vaultFileTag.updateMany).not.toHaveBeenCalled()
  })

  it('uses saved OCR text, and tolerates files deleted before OCR completion', async () => {
    mocks.vaultTag.findMany.mockResolvedValue([
      { id: 'ocr-tag', ruleText: 'acme' },
    ])
    await applyAutomaticTags('file-one', 'ocr')
    expect(mocks.vaultFileTag.createMany).toHaveBeenCalledWith({
      data: [{ fileId: 'file-one', tagId: 'ocr-tag' }],
      skipDuplicates: true,
    })
    mocks.file.findUnique.mockResolvedValue(null)
    await expect(applyAutomaticTags('deleted', 'ocr')).resolves.toBe(0)
    expect(mocks.vaultTag.findMany).toHaveBeenCalledTimes(1)
  })

  it('validates and deduplicates profile tags inside the supplied transaction', async () => {
    const transaction = {
      vaultTag: { count: vi.fn().mockResolvedValue(1) },
      vaultFileTag: { createMany: vi.fn() },
    }
    await applyProfileTags(
      transaction as never,
      { id: 'file', userId: 'owner' },
      ['tag', 'tag']
    )
    expect(transaction.vaultTag.count).toHaveBeenCalledWith({
      where: { userId: 'owner', id: { in: ['tag'] } },
    })
    expect(transaction.vaultFileTag.createMany).toHaveBeenCalledWith({
      data: [{ fileId: 'file', tagId: 'tag' }],
      skipDuplicates: true,
    })
    expect(mocks.vaultTag.count).not.toHaveBeenCalled()
    transaction.vaultTag.count.mockResolvedValue(0)
    await expect(
      applyProfileTags(transaction as never, { id: 'file', userId: 'owner' }, [
        'foreign',
      ])
    ).rejects.toMatchObject({ status: 400 })
    expect(transaction.vaultFileTag.createMany).toHaveBeenCalledTimes(1)
    await expect(validateOwnedTagIds('owner', [])).resolves.toEqual([])
  })

  it('applies existing rules using literal matches, fixed upload boundary and no exclusion updates', async () => {
    mocks.vaultTag.findFirst.mockResolvedValue({
      id: 'tag-work',
      ruleSource: 'ocr',
      ruleText: '20%_',
    })
    mocks.file.findMany.mockResolvedValue([
      { id: 'match', name: 'unrelated', ocrText: '20%_ SALE' },
      { id: 'not-match', name: '20%_', ocrText: '2000 SALE' },
    ])
    await expect(applyTagToExistingFiles('owner', 'tag-work')).resolves.toBe(1)
    expect(mocks.file.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'owner', uploadedAt: { lte: expect.any(Date) } },
        take: 500,
      })
    )
    expect(mocks.vaultFileTag.createMany).toHaveBeenCalledWith({
      data: [{ fileId: 'match', tagId: 'tag-work' }],
      skipDuplicates: true,
    })
    expect(mocks.vaultFileTag.updateMany).not.toHaveBeenCalled()
  })

  it('requires an owned tag with a rule before scanning existing files', async () => {
    mocks.vaultTag.findFirst.mockResolvedValue({
      id: 'tag',
      ruleSource: null,
      ruleText: null,
    })
    await expect(applyTagToExistingFiles('owner', 'tag')).rejects.toMatchObject(
      { status: 400 }
    )
    expect(mocks.file.findMany).not.toHaveBeenCalled()
  })
})
