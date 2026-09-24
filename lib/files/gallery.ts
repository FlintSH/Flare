import type {
  FileFilterOptions,
  FileGrouping,
  FileType,
  PaginationInfo,
} from '@/types/components/file'
import { format, startOfWeek } from 'date-fns'

export function fileQuery(filters: FileFilterOptions, page = filters.page) {
  return new URLSearchParams({
    page: page.toString(),
    limit: filters.limit.toString(),
    search: filters.search,
    sortBy: filters.sortBy,
    ...(filters.folder && { folder: filters.folder }),
    ...(filters.tag && { tag: filters.tag }),
    ...(filters.types.length > 0 && { types: filters.types.join(',') }),
    ...(filters.dateFrom && { dateFrom: filters.dateFrom }),
    ...(filters.dateTo && { dateTo: filters.dateTo }),
    ...(filters.visibility.length > 0 && {
      visibility: filters.visibility.join(','),
    }),
  })
}

export function groupFiles(files: FileType[], grouping: FileGrouping) {
  if (grouping === 'none') return [{ label: '', files }]
  const groups = new Map<string, FileType[]>()
  for (const file of files) {
    const date = new Date(file.uploadedAt)
    const label =
      grouping === 'week'
        ? `Week of ${format(startOfWeek(date, { weekStartsOn: 1 }), 'MMM d, yyyy')}`
        : format(date, grouping === 'month' ? 'MMMM yyyy' : 'yyyy')
    const group = groups.get(label)
    if (group) group.push(file)
    else groups.set(label, [file])
  }
  return Array.from(groups, ([label, groupedFiles]) => ({
    label,
    files: groupedFiles,
  }))
}

export interface GalleryPage {
  files: FileType[]
  pagination: PaginationInfo & { offset: number }
}

/** Find image neighbors by ID so changes to earlier pages cannot shift navigation. */
export async function adjacentImagePage({
  filters,
  anchorId,
  direction,
  signal,
}: {
  filters: FileFilterOptions
  anchorId: string
  direction: -1 | 1
  signal: AbortSignal
}): Promise<GalleryPage | null> {
  signal.throwIfAborted()
  const query = fileQuery(filters)
  query.delete('page')
  query.set('galleryAnchor', anchorId)
  query.set('galleryDirection', direction === 1 ? 'next' : 'previous')
  const response = await fetch(`/api/files?${query}`, { signal })
  if (response.status === 404) return null
  if (!response.ok) throw new Error('Could not load the next image')
  const result = await response.json()
  signal.throwIfAborted()
  return { files: result.data, pagination: result.pagination }
}
