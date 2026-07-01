import { useCallback, useEffect, useState } from 'react'

import { useRouter, useSearchParams } from 'next/navigation'

import {
  FileFilter,
  FileFilterOptions,
  SortOption,
  ViewMode,
} from '@/types/components/file'

const VIEW_STORAGE_KEY = 'flare:dashboard:view'
const VALID_VIEWS: ViewMode[] = ['grid', 'list', 'folder']

function readStoredView(): ViewMode | null {
  if (typeof window === 'undefined') return null
  const stored = window.localStorage.getItem(VIEW_STORAGE_KEY)
  return stored && VALID_VIEWS.includes(stored as ViewMode)
    ? (stored as ViewMode)
    : null
}

export function useFileFilters(
  options: {
    defaultLimit?: number
    onFilterChange?: (filters: FileFilter) => void
  } = {}
) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const defaultLimit = options.defaultLimit || 24

  const [filters, setFilters] = useState<FileFilterOptions>(() => {
    const viewParam = searchParams.get('view') as ViewMode | null
    const initialView =
      viewParam && VALID_VIEWS.includes(viewParam)
        ? viewParam
        : readStoredView() || 'grid'

    return {
      search: searchParams.get('search') || '',
      types: searchParams.get('types')?.split(',').filter(Boolean) || [],
      dateFrom: searchParams.get('dateFrom'),
      dateTo: searchParams.get('dateTo'),
      visibility:
        searchParams.get('visibility')?.split(',').filter(Boolean) || [],
      sortBy: (searchParams.get('sortBy') as SortOption) || 'newest',
      page: parseInt(searchParams.get('page') || '1'),
      limit: parseInt(searchParams.get('limit') || defaultLimit.toString()),
      folderId: searchParams.get('folderId'),
      tags: searchParams.get('tags')?.split(',').filter(Boolean) || [],
      viewMode: initialView,
    }
  })

  useEffect(() => {
    const params = new URLSearchParams()

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
    if (filters.folderId) params.set('folderId', filters.folderId)
    if (filters.tags.length) params.set('tags', filters.tags.join(','))
    if (filters.viewMode !== 'grid') params.set('view', filters.viewMode)

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(VIEW_STORAGE_KEY, filters.viewMode)
    }

    const newParamsString = params.toString()
    const currentParamsString = new URLSearchParams(
      window.location.search
    ).toString()

    if (newParamsString !== currentParamsString) {
      router.push(
        window.location.pathname +
          (newParamsString ? `?${newParamsString}` : '')
      )
    }

    if (options.onFilterChange) {
      options.onFilterChange(filters)
    }
  }, [filters, router, defaultLimit, options])

  const setSearch = useCallback((search: string) => {
    setFilters((prev) => ({ ...prev, search, page: 1 }))
  }, [])

  const setTypes = useCallback((types: string[]) => {
    setFilters((prev) => ({ ...prev, types, page: 1 }))
  }, [])

  const setDateRange = useCallback(
    (dateFrom: string | null, dateTo: string | null) => {
      setFilters((prev) => ({ ...prev, dateFrom, dateTo, page: 1 }))
    },
    []
  )

  const setVisibility = useCallback((visibility: string[]) => {
    setFilters((prev) => ({ ...prev, visibility, page: 1 }))
  }, [])

  const setSortBy = useCallback((sortBy: SortOption) => {
    setFilters((prev) => ({ ...prev, sortBy, page: 1 }))
  }, [])

  const setPage = useCallback((page: number) => {
    setFilters((prev) => ({ ...prev, page }))
  }, [])

  const setLimit = useCallback((limit: number) => {
    setFilters((prev) => ({ ...prev, limit, page: 1 }))
  }, [])

  const setFolderId = useCallback((folderId: string | null) => {
    setFilters((prev) => ({ ...prev, folderId, page: 1 }))
  }, [])

  const setTags = useCallback((tags: string[]) => {
    setFilters((prev) => ({ ...prev, tags, page: 1 }))
  }, [])

  const setViewMode = useCallback((viewMode: ViewMode) => {
    setFilters((prev) => ({ ...prev, viewMode }))
  }, [])

  const resetFilters = useCallback(() => {
    setFilters((prev) => ({
      search: '',
      types: [],
      dateFrom: null,
      dateTo: null,
      visibility: [],
      sortBy: 'newest' as SortOption,
      page: 1,
      limit: defaultLimit,
      folderId: null,
      tags: [],
      viewMode: prev.viewMode,
    }))
  }, [defaultLimit])

  return {
    filters,
    setSearch,
    setTypes,
    setDateRange,
    setVisibility,
    setSortBy,
    setPage,
    setLimit,
    setFolderId,
    setTags,
    setViewMode,
    resetFilters,
  }
}
