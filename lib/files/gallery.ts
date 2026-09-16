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
  pagination: PaginationInfo
}

/** Keep the current sort and filters, skipping pages without images. */
export async function adjacentImagePage({
  filters,
  page,
  pageCount,
  direction,
  signal,
}: {
  filters: FileFilterOptions
  page: number
  pageCount: number
  direction: -1 | 1
  signal: AbortSignal
}): Promise<GalleryPage | null> {
  for (
    let nextPage = page + direction;
    nextPage >= 1 && nextPage <= pageCount;
    nextPage += direction
  ) {
    signal.throwIfAborted()
    const response = await fetch(`/api/files?${fileQuery(filters, nextPage)}`, {
      signal,
    })
    if (!response.ok) throw new Error('Could not load the next image')
    const result = await response.json()
    signal.throwIfAborted()
    pageCount = result.pagination.pageCount
    const files: FileType[] = result.data.filter((file: FileType) =>
      file.mimeType.startsWith('image/')
    )
    if (files.length) return { files, pagination: result.pagination }
  }
  return null
}
