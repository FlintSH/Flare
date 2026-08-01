import { useCallback, useEffect, useState } from 'react'

import type {
  FileType,
  PaginationInfo,
  SortOption,
} from '@/types/components/file'
import type { DateRange } from 'react-day-picker'

import { FileCard } from '@/components/dashboard/file-card'
import { FileCardSkeleton } from '@/components/dashboard/file-grid/file-card-skeleton'
import { FileFilters } from '@/components/dashboard/file-grid/file-filters'
import {
  FileGridPagination,
  PaginationSkeleton,
} from '@/components/dashboard/file-grid/pagination'
import { SearchInput } from '@/components/dashboard/file-grid/search-input'
import { EmptyPlaceholder } from '@/components/shared/empty-placeholder'

import { useFileFilters } from '@/hooks/use-file-filters'

export function FileGrid() {
  const [files, setFiles] = useState<FileType[]>([])
  const [isLoading, setIsLoading] = useState(true)
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
  } = useFileFilters()

  const handleDateChange = useCallback(
    (range: DateRange | undefined) => {
      if (range?.from) {
        setDateRange(
          range.from.toISOString(),
          range.to ? range.to.toISOString() : null
        )
      } else {
        setDateRange(null, null)
      }
    },
    [setDateRange]
  )

  useEffect(() => {
    async function fetchFileTypes() {
      try {
        const response = await fetch('/api/files/types')
        if (!response.ok) {
          console.error('Failed to fetch file types, status:', response.status)
          setFileTypes([])
          return
        }
        const data = await response.json()
        setFileTypes(Array.isArray(data.data.types) ? data.data.types : [])
      } catch (error) {
        console.error('Error fetching file types:', error)
        setFileTypes([])
      }
    }
    fetchFileTypes()
  }, [])

  useEffect(() => {
    async function fetchFiles() {
      try {
        setIsLoading(true)
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
        const response = await fetch(`/api/files?${params}`)
        if (!response.ok) throw new Error('Failed to fetch files')
        const apiResult = await response.json()
        console.log(
          'API Response for /api/files:',
          JSON.stringify(apiResult, null, 2)
        )
        setFiles(Array.isArray(apiResult.data) ? apiResult.data : [])
        if (apiResult.pagination) {
          setPaginationInfo({
            total: apiResult.pagination.total || 0,
            pageCount: apiResult.pagination.pageCount || 0,
            page: filters.page,
            limit: filters.limit,
          })
        } else {
          setPaginationInfo({
            total: 0,
            pageCount: 0,
            page: filters.page,
            limit: filters.limit,
          })
        }
      } catch (error) {
        console.error('Error fetching files:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchFiles()
  }, [filters])

  const handleDelete = (fileId: string) => {
    setFiles((files) => files.filter((file) => file.id !== fileId))
    setPaginationInfo((prev) => ({
      ...prev,
      total: prev.total - 1,
      pageCount: Math.ceil((prev.total - 1) / prev.limit),
    }))
  }

  const dateRangeValue =
    filters.dateFrom || filters.dateTo
      ? {
          from: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
          to: filters.dateTo ? new Date(filters.dateTo) : undefined,
        }
      : undefined

  const renderContent = () => {
    if (isLoading) {
      return (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 24 }, (_, i) => (
              <FileCardSkeleton key={`skeleton-${Date.now()}-${i}`} />
            ))}
          </div>
          <PaginationSkeleton />
        </>
      )
    }

    if (files.length === 0 && paginationInfo.total === 0) {
      const hasActiveFilters =
        filters.search ||
        filters.types.length > 0 ||
        filters.visibility.length > 0 ||
        filters.dateFrom ||
        filters.dateTo

      return (
        <EmptyPlaceholder>
          <EmptyPlaceholder.Icon name="file" />
          {hasActiveFilters ? (
            <>
              <EmptyPlaceholder.Title>No files found</EmptyPlaceholder.Title>
              <EmptyPlaceholder.Description>
                Try adjusting your filters to find files.
              </EmptyPlaceholder.Description>
            </>
          ) : (
            <>
              <EmptyPlaceholder.Title>No files uploaded</EmptyPlaceholder.Title>
              <EmptyPlaceholder.Description>
                Upload your first file to get started.
              </EmptyPlaceholder.Description>
            </>
          )}
        </EmptyPlaceholder>
      )
    }

    return (
      <>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {files.map((file) => (
            <FileCard key={file.id} file={file} onDelete={handleDelete} />
          ))}
        </div>
        <FileGridPagination paginationInfo={paginationInfo} setPage={setPage} />
      </>
    )
  }

  return (
    <div className="space-y-6">
      {}
      <div className="relative rounded-2xl bg-white/10 dark:bg-black/10 backdrop-blur-xl border border-white/20 dark:border-white/10 shadow-lg shadow-black/5 dark:shadow-black/20">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/10 via-transparent to-black/5 dark:from-white/5 dark:via-transparent dark:to-black/10" />
        <div className="relative">
          {}
          <div className="p-6 pb-4">
            <h1 className="text-3xl font-bold">Your Files</h1>
            <p className="text-muted-foreground mt-1">
              View and manage your uploaded files
            </p>
          </div>

          {}
          <div className="px-6 pb-6">
            <div className="flex flex-col sm:flex-row gap-4">
              <SearchInput onSearch={setSearch} initialValue={filters.search} />
              <FileFilters
                sortBy={filters.sortBy as SortOption}
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
          </div>
        </div>
      </div>
      {renderContent()}
    </div>
  )
}
