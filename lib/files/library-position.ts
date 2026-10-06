import type { FileFilterOptions } from '@/types/components/file'

const HISTORY_POSITION = 'flareFileLibrary'

/** Canonical filters, including legacy page links, identify this history entry. */
export function libraryPositionKey(
  filters: FileFilterOptions,
  scope?: string
): string {
  return JSON.stringify({
    scope,
    folder: filters.folder ?? null,
    tag: filters.tag ?? null,
    search: filters.search,
    types: [...filters.types].sort(),
    visibility: [...filters.visibility].sort(),
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    sortBy: filters.sortBy,
    groupBy: filters.groupBy,
    page: filters.page,
    limit: filters.limit,
  })
}

export function readLibraryPosition(
  state: unknown,
  key: string,
  fallback: number
): number {
  const saved =
    state && typeof state === 'object'
      ? (state as Record<string, unknown>)[HISTORY_POSITION]
      : null
  if (!saved || typeof saved !== 'object') return fallback
  const { filterKey, index } = saved as { filterKey?: unknown; index?: unknown }
  return filterKey === key &&
    typeof index === 'number' &&
    Number.isSafeInteger(index) &&
    index >= 0
    ? index
    : fallback
}

/** Keep Next's tree and router markers intact; no URL or history entry is added. */
export function withLibraryPosition(
  state: unknown,
  key: string,
  index: number
) {
  return {
    ...(state && typeof state === 'object' ? state : {}),
    [HISTORY_POSITION]: { filterKey: key, index },
  }
}
