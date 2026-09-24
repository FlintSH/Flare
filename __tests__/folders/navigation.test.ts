import { describe, expect, it } from 'vitest'

import { folderPath, folderTrail } from '@/lib/folders/navigation'
import type { FolderView } from '@/lib/folders/schema'

const folders: FolderView[] = [
  {
    id: 'photos',
    name: 'Photos',
    parentId: null,
    fileCount: 0,
    shareToken: null,
  },
  {
    id: 'week-one',
    name: 'Week 1',
    parentId: 'photos',
    fileCount: 3,
    shareToken: null,
  },
  {
    id: 'assets',
    name: 'Marketing',
    parentId: null,
    fileCount: 2,
    shareToken: null,
  },
]

describe('folder navigation', () => {
  it('gives nested folders an unambiguous destination and ordered breadcrumbs', () => {
    expect(folderPath(folders, 'week-one')).toBe('Photos / Week 1')
    expect(folderTrail(folders, 'week-one').map((folder) => folder.id)).toEqual(
      ['photos', 'week-one']
    )
    expect(folderPath(folders, 'assets')).toBe('Marketing')
  })

  it('handles a stale selection after removal without inventing a breadcrumb', () => {
    expect(folderTrail(folders, 'removed')).toEqual([])
    expect(folderTrail(folders, null)).toEqual([])
  })
})
