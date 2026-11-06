import type { FileType } from '@/types/components/file'
import type { PaginationMeta } from '@/types/dto/api-responses'

import { DEFAULT_PAGE_SIZE, type LibraryFilters, listQuery } from './contract'

export interface GalleryPage {
  files: FileType[]
  pagination: PaginationMeta & { offset: number }
}

/** Find image neighbors by ID so changes to earlier pages cannot shift navigation. */
export async function adjacentImagePage({
  filters,
  anchorId,
  direction,
  signal,
}: {
  filters: LibraryFilters
  anchorId: string
  direction: -1 | 1
  signal: AbortSignal
}): Promise<GalleryPage | null> {
  signal.throwIfAborted()
  const query = listQuery(filters)
  query.set('limit', String(DEFAULT_PAGE_SIZE))
  query.set('galleryAnchor', anchorId)
  query.set('galleryDirection', direction === 1 ? 'next' : 'previous')
  const response = await fetch(`/api/files?${query}`, { signal })
  if (response.status === 404) return null
  if (!response.ok) throw new Error('Could not load the next image')
  const result = await response.json()
  signal.throwIfAborted()
  return { files: result.data, pagination: result.pagination }
}
