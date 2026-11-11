'use client'

import { useMemo } from 'react'

import { useAccountKeyState } from '@/components/providers/account-keys-provider'

import { type OwnedFolderView, ownedFolderViews } from '@/lib/folders/owned'
import type { FolderView } from '@/lib/folders/schema'
import { LIBRARY_LISTS } from '@/lib/library/changes'

import { useLibraryList } from '@/hooks/use-library-list'

/** What a folder request that gives no reason fails with. */
export const FOLDER_REQUEST_FAILED =
  'Couldn’t update folders. Please try again.'

/**
 * The folders of the account with the names that this browser can show: a
 * folder that has keys is opened with the account key, in memory
 * (docs/e2ee-spec.md, section 8.4.2). `keys` is the unlocked account, or
 * null while the browser is locked.
 */
export function useFolders() {
  const { items, ...list } = useLibraryList<FolderView>(
    LIBRARY_LISTS.folders,
    '/api/folders'
  )
  const account = useAccountKeyState()
  const keys = account.status === 'unlocked' ? account.keys : null
  const folders = useMemo<OwnedFolderView[]>(
    () => ownedFolderViews(items, keys),
    [items, keys]
  )
  // While the key state is still being read, a form waits: it cannot yet
  // tell a locked browser from one that is about to have its keys.
  return { folders, keys, keysLoading: account.status === 'loading', ...list }
}
