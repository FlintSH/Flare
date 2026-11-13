import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTag, listTags, updateTag } from '@/lib/tags/manage'
import type { TagView } from '@/lib/tags/schema'

const mocks = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  vaultTag: { create: vi.fn(), update: vi.fn() },
}))
vi.mock('@/lib/database/prisma', () => ({ prisma: mocks }))

const row = {
  id: 'tag',
  name: 'Work Notes',
  ruleSource: 'filename',
  ruleText: 'invoice',
  _count: { files: 3 },
}
const view = {
  id: 'tag',
  name: 'Work Notes',
  ruleSource: 'filename',
  ruleText: 'invoice',
  fileCount: 3,
}
const input = {
  name: 'Work Notes',
  ruleSource: 'filename' as const,
  ruleText: 'invoice',
}

/** A tag as the list query answers it: PostgreSQL counts in 64 bits. */
const listed = (tag: Partial<TagView> = {}) => ({
  ...view,
  ...tag,
  fileCount: BigInt(tag.fileCount ?? view.fileCount),
})

beforeEach(() => {
  vi.resetAllMocks()
  mocks.$queryRaw.mockResolvedValue([listed()])
  mocks.vaultTag.create.mockResolvedValue(row)
  mocks.vaultTag.update.mockResolvedValue(row)
})

describe('an account’s tags', () => {
  it('lists only the owner’s tags, ordered without regard to case', async () => {
    expect(await listTags('owner')).toEqual([view])
    expect(mocks.$queryRaw).toHaveBeenCalledOnce()
    const [sql, ...values] = mocks.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ]
    const query = sql.join('?')
    expect(values).toEqual(['owner'])
    expect(query).toContain('WHERE tag."userId" = ?')
    expect(query).toContain('ORDER BY tag."normalizedName" ASC')
    // A file whose tag link is excluded is not one of the tag's files.
    expect(query).toContain('link."tagId" = tag.id AND link.excluded = false')
  })

  it('answers each count as a number and keeps the order the database gave', async () => {
    mocks.$queryRaw.mockResolvedValue([
      listed({ id: 'b', name: 'beta', fileCount: 0 }),
      listed({ id: 'a', name: 'Alpha', fileCount: 12 }),
      listed({ id: 'c', name: 'gamma', ruleSource: null, ruleText: null }),
    ])
    const tags = await listTags('owner')
    expect(tags).toEqual([
      { ...view, id: 'b', name: 'beta', fileCount: 0 },
      { ...view, id: 'a', name: 'Alpha', fileCount: 12 },
      { ...view, id: 'c', name: 'gamma', ruleSource: null, ruleText: null },
    ])
    // A bigint would make the response impossible to send as JSON.
    expect(() => JSON.stringify(tags)).not.toThrow()
  })

  it('answers an account without tags with an empty list', async () => {
    mocks.$queryRaw.mockResolvedValue([])
    expect(await listTags('owner')).toEqual([])
  })

  it('stores the case-insensitive name key when creating and renaming', async () => {
    expect(await createTag('owner', input)).toEqual(view)
    expect(mocks.vaultTag.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { ...input, userId: 'owner', normalizedName: 'work notes' },
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
