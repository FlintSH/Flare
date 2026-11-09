import { useCallback, useEffect, useRef, useState } from 'react'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT,
  type FileGrouping,
  type IndexFilter,
  type LibraryFilters,
  RELEVANCE_SORT,
  type SortOption,
  type VisibilityFilter,
  defaultSort,
  isDateOrder,
  libraryQuery,
  librarySort,
  readLibraryFilters,
} from '@/lib/library/contract'

export function useFileFilters() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const query = searchParams.toString()
  const [filters, setFilters] = useState(() =>
    readLibraryFilters(new URLSearchParams(query))
  )
  const currentFilters = useRef(filters)

  // Browser back/forward and links to a filtered library restore the controls
  // along with the results. URL writes happen only in explicit user actions.
  useEffect(() => {
    const restored = readLibraryFilters(new URLSearchParams(query))
    if (libraryQuery(currentFilters.current) !== libraryQuery(restored)) {
      currentFilters.current = restored
      setFilters(restored)
    }
  }, [query])

  const updateFilters = useCallback(
    (changes: Partial<LibraryFilters>) => {
      const next = { ...currentFilters.current, ...changes }
      const nextQuery = libraryQuery(next)
      if (nextQuery === libraryQuery(currentFilters.current)) return
      currentFilters.current = next
      setFilters(next)
      router.push(`${pathname}${nextQuery ? `?${nextQuery}` : ''}`, {
        scroll: false,
      })
    },
    [pathname, router]
  )

  // A new search ranks by best match unless another order was chosen;
  // clearing it goes back to the order a library without a search uses.
  const setSearch = useCallback(
    (search: string) => {
      const current = currentFilters.current
      const sortBy =
        current.sortBy === defaultSort(current.search)
          ? defaultSort(search)
          : current.sortBy === RELEVANCE_SORT && !search.trim()
            ? DEFAULT_SORT
            : current.sortBy
      updateFilters({
        search,
        sortBy,
        page: 1,
        ...(!isDateOrder(librarySort(sortBy)) && { groupBy: 'none' }),
      })
    },
    [updateFilters]
  )
  const setTag = useCallback(
    (tag: string | null) => updateFilters({ tag, page: 1 }),
    [updateFilters]
  )
  const setFolder = useCallback(
    (folder: string | null) => updateFilters({ folder, page: 1 }),
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
    (visibility: VisibilityFilter[]) => updateFilters({ visibility, page: 1 }),
    [updateFilters]
  )
  const setIndexFilter = useCallback(
    (index: IndexFilter[]) => updateFilters({ index, page: 1 }),
    [updateFilters]
  )
  const setSizeRange = useCallback(
    (minSize: number | null, maxSize: number | null) =>
      updateFilters({ minSize, maxSize, page: 1 }),
    [updateFilters]
  )
  const setSortBy = useCallback(
    (sortBy: SortOption) =>
      updateFilters({
        sortBy,
        page: 1,
        ...(!isDateOrder(librarySort(sortBy)) && { groupBy: 'none' }),
      }),
    [updateFilters]
  )
  const setGroupBy = useCallback(
    (groupBy: FileGrouping) =>
      updateFilters({
        groupBy,
        page: 1,
        ...(groupBy !== 'none' &&
          !isDateOrder(librarySort(currentFilters.current.sortBy)) && {
            sortBy: DEFAULT_SORT,
          }),
      }),
    [updateFilters]
  )
  const resetFilters = useCallback(
    () =>
      updateFilters({
        search: '',
        tag: null,
        groupBy: 'none',
        types: [],
        dateFrom: null,
        dateTo: null,
        visibility: [],
        index: [],
        minSize: null,
        maxSize: null,
        sortBy: DEFAULT_SORT,
        page: 1,
        limit: DEFAULT_PAGE_SIZE,
      }),
    [updateFilters]
  )

  return {
    filters,
    urlQuery: query,
    pathname,
    setFolder,
    setTag,
    setSearch,
    setTypes,
    setDateRange,
    setVisibility,
    setIndexFilter,
    setSizeRange,
    setSortBy,
    setGroupBy,
    resetFilters,
  }
}
