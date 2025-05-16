import { useCallback, useEffect, useState } from 'react'

import { useRouter, useSearchParams } from 'next/navigation'

import { FileFilter, FileFilterOptions } from '@/types/components/file'

export function useFileFilters(
  options: {
    defaultLimit?: number
    onFilterChange?: (filters: FileFilter) => void
  } = {}
) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const defaultLimit = options.defaultLimit || 24

  // Initialize filters from URL search params
  const [filters, setFilters] = useState<FileFilterOptions>({
    search: searchParams.get('search') || '',
    types: searchParams.get('types')?.split(',').filter(Boolean) || [],
    dateFrom: searchParams.get('dateFrom'),
    dateTo: searchParams.get('dateTo'),
    visibility:
      searchParams.get('visibility')?.split(',').filter(Boolean) || [],
    sortBy: searchParams.get('sortBy') || 'newest',
    page: parseInt(searchParams.get('page') || '1'),
    limit: parseInt(searchParams.get('limit') || defaultLimit.toString()),
  })

  // Update URL when filters change
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

    // Only update URL if user navigated to a new page or changed filters
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

  // Helper functions to update filters
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

  const setSortBy = useCallback((sortBy: string) => {
    setFilters((prev) => ({ ...prev, sortBy, page: 1 }))
  }, [])

  const setPage = useCallback((page: number) => {
    setFilters((prev) => ({ ...prev, page }))
  }, [])

  const setLimit = useCallback((limit: number) => {
    setFilters((prev) => ({ ...prev, limit, page: 1 }))
  }, [])

  const resetFilters = useCallback(() => {
    setFilters({
      search: '',
      types: [],
      dateFrom: null,
      dateTo: null,
      visibility: [],
      sortBy: 'newest',
      page: 1,
      limit: defaultLimit,
    })
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
    resetFilters,
  }
}
