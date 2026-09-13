import { useCallback, useEffect, useState } from 'react'

import Link from 'next/link'

import type { FileType, PaginationInfo } from '@/types/components/file'
import { endOfDay } from 'date-fns'
import {
  AlertCircle,
  FolderOpen,
  RefreshCw,
  SearchX,
  Upload,
  X,
} from 'lucide-react'
import type { DateRange } from 'react-day-picker'

import { FileCard } from '@/components/dashboard/file-card'
import { FileCardSkeleton } from '@/components/dashboard/file-grid/file-card-skeleton'
import { FileFilters } from '@/components/dashboard/file-grid/file-filters'
import { FileGridPagination } from '@/components/dashboard/file-grid/pagination'
import { SearchInput } from '@/components/dashboard/file-grid/search-input'
import { Button } from '@/components/ui/button'

import { useFileFilters } from '@/hooks/use-file-filters'

export function FileGrid() {
  const [files, setFiles] = useState<FileType[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [fileTypes, setFileTypes] = useState<string[]>([])
  const [paginationInfo, setPaginationInfo] = useState<PaginationInfo>({
    total: 0,
    pageCount: 0,
    page: 1,
    limit: 24,
  })
  const {
    filters,
    setSearch,
    setTypes,
    setDateRange,
    setVisibility,
    setSortBy,
    setPage,
    resetFilters,
  } = useFileFilters()
  const refreshFiles = useCallback(
    () => setRefreshKey((value) => value + 1),
    []
  )
  const hasActiveFilters = Boolean(
    filters.search ||
      filters.types.length ||
      filters.visibility.length ||
      filters.dateFrom ||
      filters.dateTo
  )

  useEffect(() => {
    window.addEventListener('flare:files-changed', refreshFiles)
    return () => window.removeEventListener('flare:files-changed', refreshFiles)
  }, [refreshFiles])

  const handleDateChange = useCallback(
    (range: DateRange | undefined) => {
      setDateRange(
        range?.from?.toISOString() || null,
        range?.to ? endOfDay(range.to).toISOString() : null
      )
    },
    [setDateRange]
  )

  useEffect(() => {
    const controller = new AbortController()
    async function fetchFileTypes() {
      try {
        const response = await fetch('/api/files/types', {
          signal: controller.signal,
        })
        if (!response.ok) return
        const data = await response.json()
        if (!controller.signal.aborted)
          setFileTypes(Array.isArray(data.data?.types) ? data.data.types : [])
      } catch {
        // File type suggestions are optional; the library remains searchable.
      }
    }
    void fetchFileTypes()
    return () => controller.abort()
  }, [refreshKey])

  useEffect(() => {
    const controller = new AbortController()
    let changingPage = false
    async function fetchFiles() {
      setIsLoading(true)
      setError(false)
      try {
        const params = new URLSearchParams({
          page: filters.page.toString(),
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
        const response = await fetch(`/api/files?${params}`, {
          signal: controller.signal,
        })
        if (!response.ok) throw new Error('Failed to fetch files')
        const result = await response.json()
        if (controller.signal.aborted) return
        const total = result.pagination?.total || 0
        const pageCount = result.pagination?.pageCount || 0
        // Deleting the last file on a page should take you to the previous page.
        if (filters.page > Math.max(1, pageCount)) {
          changingPage = true
          setPage(Math.max(1, pageCount))
          return
        }
        setFiles(Array.isArray(result.data) ? result.data : [])
        setPaginationInfo({
          total,
          pageCount,
          page: filters.page,
          limit: filters.limit,
        })
      } catch {
        if (!controller.signal.aborted) setError(true)
      } finally {
        if (!controller.signal.aborted && !changingPage) setIsLoading(false)
      }
    }
    void fetchFiles()
    return () => controller.abort()
  }, [filters, refreshKey, setPage])

  const dateRangeValue =
    filters.dateFrom || filters.dateTo
      ? {
          from: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
          to: filters.dateTo ? new Date(filters.dateTo) : undefined,
        }
      : undefined

  return (
    <div className="space-y-6">
      <section
        aria-label="Find and filter files"
        className="rounded-2xl border border-border/60 bg-background/70 p-5 shadow-sm backdrop-blur-xl sm:p-6"
      >
        <div className="mb-4">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-3xl font-bold">Your Files</h1>
            <div className="flex shrink-0 items-center gap-2">
              <span
                role="status"
                aria-live="polite"
                className="text-xs text-muted-foreground"
              >
                {isLoading
                  ? 'Loading…'
                  : error
                    ? 'Unavailable'
                    : `${paginationInfo.total.toLocaleString()} ${paginationInfo.total === 1 ? 'file' : 'files'}`}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Refresh files"
                disabled={isLoading}
                onClick={refreshFiles}
              >
                <RefreshCw
                  className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
                />
              </Button>
            </div>
          </div>
          <p className="mt-1 text-muted-foreground">
            View and manage your uploaded files
          </p>
        </div>
        <div className="flex flex-col gap-3 lg:flex-row">
          <SearchInput onSearch={setSearch} initialValue={filters.search} />
          <FileFilters
            sortBy={filters.sortBy}
            onSortChange={setSortBy}
            selectedTypes={filters.types}
            onTypesChange={setTypes}
            fileTypes={fileTypes}
            date={dateRangeValue}
            onDateChange={handleDateChange}
            visibility={filters.visibility}
            onVisibilityChange={setVisibility}
          />
        </div>
        {(hasActiveFilters || filters.sortBy !== 'newest') && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {filters.search && (
              <span className="max-w-full truncate rounded-lg bg-muted px-2.5 py-1 text-xs">
                Search: {filters.search}
              </span>
            )}
            {filters.types.length > 0 && (
              <span className="rounded-lg bg-muted px-2.5 py-1 text-xs">
                {filters.types.length} file{' '}
                {filters.types.length === 1 ? 'type' : 'types'}
              </span>
            )}
            {filters.visibility.map((value) => (
              <span
                key={value}
                className="rounded-lg bg-muted px-2.5 py-1 text-xs"
              >
                {value === 'hasPassword'
                  ? 'Password protected'
                  : value === 'private'
                    ? 'Private'
                    : 'Public'}
              </span>
            ))}
            {(filters.dateFrom || filters.dateTo) && (
              <span className="rounded-lg bg-muted px-2.5 py-1 text-xs">
                Upload date selected
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 rounded-lg text-xs"
              onClick={resetFilters}
            >
              <X className="mr-1 h-3 w-3" />
              Reset filters
            </Button>
          </div>
        )}
      </section>

      {isLoading ? (
        <div
          aria-busy="true"
          aria-label="Loading files"
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {Array.from({ length: 8 }, (_, index) => (
            <FileCardSkeleton key={index} />
          ))}
        </div>
      ) : error ? (
        <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-border/60 bg-background/70 p-6 text-center">
          <div className="mb-4 rounded-xl bg-destructive/10 p-3 text-destructive">
            <AlertCircle className="h-7 w-7" />
          </div>
          <h2 className="text-xl font-semibold">Couldn’t load your files</h2>
          <p className="mb-6 mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            Check your connection and try again. Your search and filters are
            saved.
          </p>
          <Button onClick={refreshFiles}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Try again
          </Button>
        </div>
      ) : files.length === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border/60 bg-background/70 p-6 text-center">
          <div className="mb-4 rounded-xl bg-primary/10 p-3 text-primary">
            {hasActiveFilters ? (
              <SearchX className="h-7 w-7" />
            ) : (
              <FolderOpen className="h-7 w-7" />
            )}
          </div>
          <h2 className="text-xl font-semibold">
            {hasActiveFilters
              ? 'No files match your search'
              : 'No files uploaded'}
          </h2>
          <p className="mb-6 mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            {hasActiveFilters
              ? 'Try another file name or reset your filters to see everything in your library.'
              : 'Upload your first file to get started.'}
          </p>
          {hasActiveFilters ? (
            <Button variant="outline" onClick={resetFilters}>
              Reset filters
            </Button>
          ) : (
            <Button asChild>
              <Link href="/dashboard/upload">
                <Upload className="mr-2 h-4 w-4" />
                Upload your first file
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {files.map((file) => (
              <FileCard
                key={file.id}
                file={file}
                onDelete={refreshFiles}
                onUpdate={refreshFiles}
              />
            ))}
          </div>
          <FileGridPagination
            paginationInfo={paginationInfo}
            setPage={setPage}
          />
        </>
      )}
    </div>
  )
}
