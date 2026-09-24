import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { savedViewInputSchema } from '@/lib/saved-views/schema'
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  updateSavedView,
} from '@/lib/saved-views/service'

const mocks = vi.hoisted(() => ({
  user: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  vaultFolder: { findFirst: vi.fn(), findMany: vi.fn() },
  vaultTag: { findFirst: vi.fn(), findMany: vi.fn() },
  $queryRaw: vi.fn(),
  transaction: vi.fn(),
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: { ...mocks, $transaction: mocks.transaction },
}))
const input = savedViewInputSchema.parse({
  name: 'Inbox',
  filters: { folder: 'unfiled', tag: 'untagged' },
})
const view = { ...input, id: randomUUID(), revision: 1 }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.transaction.mockImplementation((callback) => callback(mocks))
  mocks.user.findUniqueOrThrow.mockResolvedValue({
    preferences: {
      customization: { themeMode: 'dark' },
      anotherPreference: 42,
      savedViews: [view],
    },
  })
  mocks.vaultFolder.findMany.mockResolvedValue([])
  mocks.vaultTag.findMany.mockResolvedValue([])
})

describe('account saved view persistence', () => {
  it('locks the user before reading or writing and preserves all sibling preferences', async () => {
    await updateSavedView('owner', view.id, { revision: 1, pinned: false })
    expect(mocks.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.user.findUniqueOrThrow.mock.invocationCallOrder[0]
    )
    expect(mocks.user.update).toHaveBeenCalledWith({
      where: { id: 'owner' },
      data: {
        preferences: {
          customization: { themeMode: 'dark' },
          anotherPreference: 42,
          savedViews: [{ ...view, pinned: false, revision: 2 }],
        },
      },
    })
  })

  it('rejects unavailable and foreign folder/tag IDs inside the owner lock', async () => {
    for (const filters of [{ folder: 'foreign' }, { tag: 'foreign' }]) {
      await expect(
        createSavedView(
          'owner',
          savedViewInputSchema.parse({ name: 'Foreign', filters })
        )
      ).rejects.toMatchObject({ status: 404 })
    }
    expect(mocks.vaultFolder.findFirst).toHaveBeenCalledWith({
      where: { id: 'foreign', userId: 'owner' },
      select: { id: true },
    })
    expect(mocks.vaultTag.findFirst).toHaveBeenCalledWith({
      where: { id: 'foreign', userId: 'owner' },
      select: { id: true },
    })
    expect(mocks.user.update).not.toHaveBeenCalled()
  })

  it('marks missing references unavailable without changing the stored filters and still permits rename', async () => {
    const broken = {
      ...view,
      filters: {
        ...view.filters,
        tag: 'deleted-tag',
        folder: 'deleted-folder',
      },
    }
    mocks.user.findUniqueOrThrow.mockResolvedValue({
      preferences: { savedViews: [broken] },
    })
    expect(await listSavedViews('owner')).toEqual([
      {
        ...broken,
        unavailableReason: expect.stringContaining('folder and tag'),
      },
    ])
    expect(
      await updateSavedView('owner', view.id, {
        revision: 1,
        name: 'Repair later',
      })
    ).toMatchObject({
      filters: broken.filters,
      name: 'Repair later',
      unavailableReason: expect.stringContaining('folder and tag'),
      revision: 2,
    })
    expect(mocks.vaultFolder.findFirst).not.toHaveBeenCalled()
    expect(mocks.vaultTag.findFirst).not.toHaveBeenCalled()
  })

  it('rejects duplicate names, full libraries, unknown IDs, and stale revisions without persisting', async () => {
    await expect(
      createSavedView('owner', { ...input, name: 'INBOX' })
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      updateSavedView('owner', view.id, { revision: 2, name: 'Renamed' })
    ).rejects.toMatchObject({ status: 409, code: 'SAVED_VIEW_STALE' })
    await expect(
      deleteSavedView('other', 'foreign-view', 1)
    ).rejects.toMatchObject({ status: 404 })
    await expect(deleteSavedView('owner', view.id, 2)).rejects.toMatchObject({
      status: 409,
    })
    mocks.user.findUniqueOrThrow.mockResolvedValue({
      preferences: {
        savedViews: Array.from({ length: 20 }, (_, index) => ({
          ...view,
          id: randomUUID(),
          name: `View ${index}`,
        })),
      },
    })
    await expect(createSavedView('owner', input)).rejects.toMatchObject({
      status: 409,
    })
    expect(mocks.user.update).not.toHaveBeenCalled()
  })

  it('never overwrites malformed saved preferences with an empty library', async () => {
    mocks.user.findUniqueOrThrow.mockResolvedValue({
      preferences: { savedViews: [{ name: 'Malformed existing view' }] },
    })
    await expect(createSavedView('owner', input)).rejects.toMatchObject({
      status: 500,
    })
    expect(mocks.user.update).not.toHaveBeenCalled()
  })
})
