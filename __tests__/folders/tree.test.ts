import { describe, expect, it } from 'vitest'

import {
  buildFolderTree,
  getBreadcrumb,
  getDescendantIds,
  wouldCreateCycle,
} from '@/lib/folders/tree'
import type { FolderDTO } from '@/types/dto/folder'

function folder(
  id: string,
  parentId: string | null,
  name = id,
  fileCount = 0
): FolderDTO {
  return {
    id,
    name,
    color: null,
    parentId,
    createdAt: new Date(),
    updatedAt: new Date(),
    fileCount,
  }
}

describe('buildFolderTree', () => {
  it('nests children under parents and keeps roots at top', () => {
    const tree = buildFolderTree([
      folder('a', null, 'Alpha'),
      folder('b', 'a', 'Bravo'),
      folder('c', 'a', 'Charlie'),
      folder('d', null, 'Delta'),
    ])
    expect(tree.map((n) => n.id)).toEqual(['a', 'd'])
    const a = tree.find((n) => n.id === 'a')!
    expect(a.children.map((c) => c.id)).toEqual(['b', 'c'])
  })

  it('sorts alphabetically at each level', () => {
    const tree = buildFolderTree([
      folder('z', null, 'Zebra'),
      folder('a', null, 'Apple'),
    ])
    expect(tree.map((n) => n.name)).toEqual(['Apple', 'Zebra'])
  })

  it('aggregates descendant file counts into totalFileCount', () => {
    const tree = buildFolderTree([
      folder('a', null, 'A', 2),
      folder('b', 'a', 'B', 3),
      folder('c', 'b', 'C', 5),
    ])
    const a = tree[0]
    expect(a.fileCount).toBe(2)
    expect(a.totalFileCount).toBe(10)
  })

  it('treats folders with a missing parent as roots', () => {
    const tree = buildFolderTree([folder('orphan', 'ghost', 'Orphan')])
    expect(tree.map((n) => n.id)).toEqual(['orphan'])
  })
})

describe('getDescendantIds', () => {
  it('returns all descendants, not the node itself', () => {
    const folders = [
      folder('a', null),
      folder('b', 'a'),
      folder('c', 'b'),
      folder('d', null),
    ]
    expect(getDescendantIds(folders, 'a').sort()).toEqual(['b', 'c'])
    expect(getDescendantIds(folders, 'd')).toEqual([])
  })
})

describe('wouldCreateCycle', () => {
  const folders = [folder('a', null), folder('b', 'a'), folder('c', 'b')]

  it('allows moving to root', () => {
    expect(wouldCreateCycle(folders, 'b', null)).toBe(false)
  })

  it('forbids moving into itself', () => {
    expect(wouldCreateCycle(folders, 'a', 'a')).toBe(true)
  })

  it('forbids moving into a descendant', () => {
    expect(wouldCreateCycle(folders, 'a', 'c')).toBe(true)
  })

  it('allows moving into an unrelated folder', () => {
    expect(wouldCreateCycle(folders, 'c', 'a')).toBe(false)
  })
})

describe('getBreadcrumb', () => {
  const folders = [
    folder('a', null, 'Alpha'),
    folder('b', 'a', 'Bravo'),
    folder('c', 'b', 'Charlie'),
  ]

  it('builds the path from root to the folder', () => {
    expect(getBreadcrumb(folders, 'c')).toEqual([
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Bravo' },
      { id: 'c', name: 'Charlie' },
    ])
  })

  it('handles a root folder', () => {
    expect(getBreadcrumb(folders, 'a')).toEqual([{ id: 'a', name: 'Alpha' }])
  })

  it('returns empty for an unknown folder', () => {
    expect(getBreadcrumb(folders, 'missing')).toEqual([])
  })
})
