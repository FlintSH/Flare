'use client'

import { LIBRARY_LISTS } from '@/lib/library/changes'
import type { TagView } from '@/lib/tags/schema'

import { useLibraryList } from '@/hooks/use-library-list'

/** What a tag request that gives no reason fails with. */
export const TAG_REQUEST_FAILED = 'Couldn’t update tags. Please try again.'

export function useTags() {
  const { items, ...list } = useLibraryList<TagView>(
    LIBRARY_LISTS.tags,
    '/api/tags'
  )
  return { tags: items, ...list }
}
