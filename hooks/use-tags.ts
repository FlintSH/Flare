'use client'

import { useMemo } from 'react'

import { useAccountKeyState } from '@/components/providers/account-keys-provider'

import { LIBRARY_LISTS } from '@/lib/library/changes'
import { type OwnedTagView, ownedTagViews } from '@/lib/tags/owned'
import type { TagView } from '@/lib/tags/schema'

import { useLibraryList } from '@/hooks/use-library-list'

/** What a tag request that gives no reason fails with. */
export const TAG_REQUEST_FAILED = 'Couldn’t update tags. Please try again.'

/**
 * The tags of the account with the names and rules that this browser can
 * show: a sealed tag is opened with the account key, in memory
 * (docs/e2ee-spec.md, section 9.5). `keys` is the unlocked account, or null
 * while the browser is locked.
 */
export function useTags() {
  const { items, ...list } = useLibraryList<TagView>(
    LIBRARY_LISTS.tags,
    '/api/tags'
  )
  const account = useAccountKeyState()
  const keys = account.status === 'unlocked' ? account.keys : null
  const tags = useMemo<OwnedTagView[]>(
    () => ownedTagViews(items, keys),
    [items, keys]
  )
  return { tags, keys, ...list }
}

/**
 * The tags of a file row with the names this browser opened. The server
 * lists a sealed tag by its ID only.
 */
export function useNamedTags(
  fileTags: readonly { id: string; name: string }[] | undefined
) {
  const { tags } = useTags()
  return useMemo(() => {
    if (!fileTags?.length) return []
    const names = new Map(tags.map((tag) => [tag.id, tag.name]))
    return fileTags
      .map((tag) => ({ ...tag, name: names.get(tag.id) ?? tag.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [fileTags, tags])
}
