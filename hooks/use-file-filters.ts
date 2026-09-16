import { useCallback, useEffect, useRef, useState } from 'react'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import {
  FileFilter,
  FileFilterOptions,
  FileGrouping,
  SortOption,
} from '@/types/components/file'

const sortOptions: SortOption[] = [
  'newest',
  'oldest',
  'largest',
  'smallest',
  'most-viewed',
  'least-viewed',
  'most-downloaded',
  'least-downloaded',
]
const visibilityOptions = ['public', 'private', 'hasPassword']
const groupOptions: FileGrouping[] = ['none', 'week', 'month', 'year']

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function validDate(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function readFilters(
  params: URLSearchParams,
  defaultLimit: number
): FileFilterOptions {
  const sortBy = params.get('sortBy') as SortOption
  const groupBy = params.get('groupBy') as FileGrouping
  const selectedSort = sortOptions.includes(sortBy) ? sortBy : 'newest'
  return {
    groupBy:
      groupOptions.includes(groupBy) &&
      (selectedSort === 'newest' || selectedSort === 'oldest')
        ? groupBy
        : 'none',
    search: params.get('search') || '',
    types: [...new Set(params.get('types')?.split(',').filter(Boolean) || [])],
    dateFrom: validDate(params.get('dateFrom')),
    dateTo: validDate(params.get('dateTo')),
    visibility: [
      ...new Set(
        params
          .get('visibility')
          ?.split(',')
          .filter((value) => visibilityOptions.includes(value)) || []
      ),
    ],
    sortBy: selectedSort,
    page: positiveInteger(params.get('page'), 1),
    limit: Math.min(positiveInteger(params.get('limit'), defaultLimit), 100),
  }
}

function writeFilters(filters: FileFilterOptions, defaultLimit: number) {
  const params = new URLSearchParams()
  if (filters.groupBy !== 'none') params.set('groupBy', filters.groupBy)
  if (filters.search) params.set('search', filters.search)
  if (filters.types.length) params.set('types', filters.types.join(','))
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) params.set('dateTo', filters.dateTo)
  if (filters.visibility.length)
    params.set('visibility', filters.visibility.join(','))
  if (filters.sortBy !== 'newest') params.set('sortBy', filters.sortBy)
  if (filters.page !== 1) params.set('page', filters.page.toString())
  if (filters.limit !== defaultLimit)
    params.set('limit', filters.limit.toString())
  return params.toString()
}

export function useFileFilters(
  options: {
    defaultLimit?: number
    onFilterChange?: (filters: FileFilter) => void
  } = {}
) {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const defaultLimit = Math.min(
    positiveInteger(String(options.defaultLimit ?? 24), 24),
    100
  )
  const query = searchParams.toString()
  const [filters, setFilters] = useState(() =>
    readFilters(new URLSearchParams(query), defaultLimit)
  )
  const currentFilters = useRef(filters)

  // Browser back/forward and links to a filtered library restore the controls
  // along with the results. URL writes happen only in explicit user actions.
  useEffect(() => {
    const restored = readFilters(new URLSearchParams(query), defaultLimit)
    if (
      writeFilters(currentFilters.current, defaultLimit) !==
      writeFilters(restored, defaultLimit)
    ) {
      currentFilters.current = restored
      setFilters(restored)
    }
  }, [query, defaultLimit])

  const updateFilters = useCallback(
    (changes: Partial<FileFilterOptions>) => {
      const next = { ...currentFilters.current, ...changes }
      const nextQuery = writeFilters(next, defaultLimit)
      if (nextQuery === writeFilters(currentFilters.current, defaultLimit))
        return
      currentFilters.current = next
      setFilters(next)
      router.push(`${pathname}${nextQuery ? `?${nextQuery}` : ''}`, {
        scroll: false,
      })
    },
    [defaultLimit, pathname, router]
  )

  const onFilterChange = options.onFilterChange
  useEffect(() => {
    onFilterChange?.(filters)
  }, [filters, onFilterChange])

  const setSearch = useCallback(
    (search: string) => updateFilters({ search, page: 1 }),
    [updateFilters]
  )
  const setTypes = useCallback(
    (types: string[]) => updateFilters({ types, page: 1 }),
    [updateFilters]
  )
  const setDateRange = useCallback(
    (dateFrom: string | null, dateTo: string | null) =>
      updateFilters({ dateFrom, dateTo, page: 1 }),
    [updateFilters]
  )
  const setVisibility = useCallback(
    (visibility: string[]) => updateFilters({ visibility, page: 1 }),
    [updateFilters]
  )
  const setSortBy = useCallback(
    (sortBy: SortOption) =>
      updateFilters({
        sortBy,
        page: 1,
        ...(sortBy !== 'newest' && sortBy !== 'oldest' && { groupBy: 'none' }),
      }),
    [updateFilters]
  )
  const setGroupBy = useCallback(
    (groupBy: FileGrouping) =>
      updateFilters({
        groupBy,
        page: 1,
        ...(groupBy !== 'none' &&
          currentFilters.current.sortBy !== 'newest' &&
          currentFilters.current.sortBy !== 'oldest' && {
            sortBy: 'newest',
          }),
      }),
    [updateFilters]
  )
  const setPage = useCallback(
    (page: number) => updateFilters({ page: positiveInteger(String(page), 1) }),
    [updateFilters]
  )
  const setLimit = useCallback(
    (limit: number) =>
      updateFilters({
        limit: Math.min(positiveInteger(String(limit), defaultLimit), 100),
        page: 1,
      }),
    [defaultLimit, updateFilters]
  )
  const resetFilters = useCallback(
    () =>
      updateFilters({
        search: '',
        groupBy: 'none',
        types: [],
        dateFrom: null,
        dateTo: null,
        visibility: [],
        sortBy: 'newest',
        page: 1,
        limit: defaultLimit,
      }),
    [defaultLimit, updateFilters]
  )

  return {
    filters,
    setSearch,
    setTypes,
    setDateRange,
    setVisibility,
    setSortBy,
    setGroupBy,
    setPage,
    setLimit,
    resetFilters,
  }
}
