'use client'

import type { FolderView } from '@/lib/folders/schema'
import { LIBRARY_LISTS } from '@/lib/library/changes'

import { useLibraryList } from '@/hooks/use-library-list'

/** What a folder request that gives no reason fails with. */
export const FOLDER_REQUEST_FAILED =
  'Couldn’t update folders. Please try again.'

export function useFolders() {
  const { items, ...list } = useLibraryList<FolderView>(
    LIBRARY_LISTS.folders,
    '/api/folders'
  )
  return { folders: items, ...list }
}
