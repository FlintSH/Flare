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
  const firstResult = (paginationInfo.page - 1) * paginationInfo.limit + 1

  return (
    <div className="space-y-5">
      <section
        aria-label="Find and filter files"
        className="rounded-2xl border bg-card p-4 sm:p-5"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FolderOpen className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Your library</h2>
              <p className="text-xs text-muted-foreground">
                Find, share, and manage your uploads.
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-xl"
            aria-label="Refresh files"
            disabled={isLoading}
            onClick={refreshFiles}
          >
            <RefreshCw
              className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
            />
          </Button>
        </div>
        <div className="flex flex-col gap-3 xl:flex-row">
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
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
            <span className="mr-1 text-xs text-muted-foreground">
              Filtered library
            </span>
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

      <div
        role="status"
        aria-live="polite"
        className="flex min-h-5 items-center justify-between gap-3 px-1 text-sm text-muted-foreground"
      >
        <span>
          {isLoading
            ? 'Loading your files…'
            : error
              ? 'Your library is temporarily unavailable'
              : `${paginationInfo.total.toLocaleString()} ${hasActiveFilters ? 'matching ' : ''}${paginationInfo.total === 1 ? 'file' : 'files'}`}
        </span>
        {!isLoading && !error && files.length > 0 && (
          <span className="text-xs">
            Showing {firstResult}–{firstResult + files.length - 1}
          </span>
        )}
      </div>

      {isLoading ? (
        <div
          aria-busy="true"
          aria-label="Loading files"
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
        >
          {Array.from({ length: 8 }, (_, index) => (
            <FileCardSkeleton key={index} />
          ))}
        </div>
      ) : error ? (
        <div className="flex min-h-80 flex-col items-center justify-center rounded-2xl border bg-card p-8 text-center">
          <div className="mb-5 rounded-2xl bg-destructive/10 p-4 text-destructive">
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
        <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-dashed bg-card p-8 text-center">
          <div className="mb-5 rounded-2xl bg-primary/10 p-4 text-primary">
            {hasActiveFilters ? (
              <SearchX className="h-7 w-7" />
            ) : (
              <FolderOpen className="h-7 w-7" />
            )}
          </div>
          <h2 className="text-xl font-semibold">
            {hasActiveFilters
              ? 'No files match your search'
              : 'Your files, all in one place'}
          </h2>
          <p className="mb-6 mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            {hasActiveFilters
              ? 'Try another file name or reset your filters to see everything in your library.'
              : 'Upload an image, document, or anything you want to share. Its link and sharing controls will be ready here.'}
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
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
