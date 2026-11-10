import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTag, listTags, updateTag } from '@/lib/tags/manage'

const mocks = vi.hoisted(() => ({
  vaultTag: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}))
vi.mock('@/lib/database/prisma', () => ({ prisma: mocks }))

const row = {
  id: 'tag',
  name: 'Work Notes',
  ruleSource: 'filename',
  ruleText: 'invoice',
  sealedTagMetadata: null,
  _count: { files: 3 },
}
const view = {
  id: 'tag',
  name: 'Work Notes',
  ruleSource: 'filename',
  ruleText: 'invoice',
  fileCount: 3,
  sealed: null,
}
const input = {
  name: 'Work Notes',
  ruleSource: 'filename' as const,
  ruleText: 'invoice',
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.$transaction.mockImplementation((callback) => callback(mocks))
  // An account without encryption keys: its tags keep plain names.
  mocks.user.findUnique.mockResolvedValue({ accountPublicKey: null })
  mocks.vaultTag.findMany.mockResolvedValue([row])
  mocks.vaultTag.create.mockResolvedValue(row)
  mocks.vaultTag.update.mockResolvedValue(row)
})

describe('an account’s tags', () => {
  it('lists only the owner’s tags, ordered without regard to case', async () => {
    expect(await listTags('owner')).toEqual([view])
    expect(mocks.vaultTag.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'owner' },
        orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
      })
    )
  })

  it('stores the case-insensitive name key when creating and renaming', async () => {
    expect(await createTag('owner', input)).toEqual(view)
    expect(mocks.vaultTag.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          ...input,
          id: expect.any(String),
          userId: 'owner',
          normalizedName: 'work notes',
        },
      })
    )
    expect(await updateTag('owner', 'tag', input)).toEqual(view)
    expect(mocks.vaultTag.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tag', userId: 'owner' },
        data: { ...input, normalizedName: 'work notes' },
      })
    )
  })
})
