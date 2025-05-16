'use client'

import { memo, useCallback, useEffect, useState } from 'react'

import { format } from 'date-fns'
import {
  ArrowUpDown,
  Calendar as CalendarIcon,
  Eye,
  Filter,
  Search,
} from 'lucide-react'
import { DateRange } from 'react-day-picker'

import { FileCard } from '@/components/dashboard/file-card'
import { EmptyPlaceholder } from '@/components/shared/empty-placeholder'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

import { cn } from '@/lib/utils'

import { useDebounce } from '@/hooks/use-debounce'
import { useFileFilters } from '@/hooks/use-file-filters'

interface FileType {
  id: string
  name: string
  urlPath: string
  mimeType: string
  visibility: 'PUBLIC' | 'PRIVATE'
  password: string | null
  size: number
  uploadedAt: string
  views: number
  downloads: number
}

interface PaginationInfo {
  total: number
  pageCount: number
  page: number
  limit: number
}

type SortOption = 'newest' | 'oldest' | 'largest' | 'smallest'

interface FiltersProps {
  sortBy: SortOption
  onSortChange: (value: SortOption) => void
  selectedTypes: string[]
  onTypesChange: (types: string[]) => void
  fileTypes: string[]
  date: DateRange | undefined
  onDateChange: (range: DateRange | undefined) => void
  visibility: string[]
  onVisibilityChange: (visibility: string[]) => void
}

// Add SearchInput component
const SearchInput = memo(function SearchInput({
  onSearch,
}: {
  onSearch: (value: string) => void
}) {
  const [value, setValue] = useState('')
  const debouncedSearch = useDebounce(value, 300)

  useEffect(() => {
    onSearch(debouncedSearch)
  }, [debouncedSearch, onSearch])

  return (
    <div className="relative flex-1">
      <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        placeholder="Search files..."
        className="pl-8"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </div>
  )
})

const Filters = memo(function Filters({
  sortBy,
  onSortChange,
  selectedTypes,
  onTypesChange,
  fileTypes,
  date,
  onDateChange,
  visibility,
  onVisibilityChange,
}: FiltersProps) {
  return (
    <div className="flex gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="w-[120px]">
            {sortBy === 'newest'
              ? 'Newest'
              : sortBy === 'oldest'
                ? 'Oldest'
                : sortBy === 'largest'
                  ? 'Largest'
                  : 'Smallest'}
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => onSortChange('newest')}>
            Newest first
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onSortChange('oldest')}>
            Oldest first
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onSortChange('largest')}>
            Largest first
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onSortChange('smallest')}>
            Smallest first
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="min-w-[120px] flex items-center justify-between"
          >
            <span>Visibility</span>
            {visibility.length > 0 ? (
              <span className="ml-2 rounded-full bg-primary w-5 h-5 flex items-center justify-center text-[10px] font-medium text-primary-foreground">
                {visibility.length}
              </span>
            ) : (
              <Eye className="ml-2 h-4 w-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Filter by visibility</DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            checked={visibility.includes('public')}
            onCheckedChange={() => {
              const newVisibility = visibility.includes('public')
                ? visibility.filter((v) => v !== 'public')
                : [...visibility, 'public']
              onVisibilityChange(newVisibility)
            }}
          >
            Public Files
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={visibility.includes('private')}
            onCheckedChange={() => {
              const newVisibility = visibility.includes('private')
                ? visibility.filter((v) => v !== 'private')
                : [...visibility, 'private']
              onVisibilityChange(newVisibility)
            }}
          >
            Private Files
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={visibility.includes('hasPassword')}
            onCheckedChange={() => {
              const newVisibility = visibility.includes('hasPassword')
                ? visibility.filter((v) => v !== 'hasPassword')
                : [...visibility, 'hasPassword']
              onVisibilityChange(newVisibility)
            }}
          >
            Password Protected
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="min-w-[120px] flex items-center justify-between"
          >
            <span>File Type</span>
            {selectedTypes.length > 0 ? (
              <span className="ml-2 rounded-full bg-primary w-5 h-5 flex items-center justify-center text-[10px] font-medium text-primary-foreground">
                {selectedTypes.length}
              </span>
            ) : (
              <Filter className="ml-2 h-4 w-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="max-h-[300px] overflow-y-auto"
        >
          <DropdownMenuLabel>Filter by type</DropdownMenuLabel>
          {fileTypes.map((type) => (
            <DropdownMenuCheckboxItem
              key={type}
              checked={selectedTypes.includes(type)}
              onCheckedChange={(checked) => {
                onTypesChange(
                  checked
                    ? [...selectedTypes, type]
                    : selectedTypes.filter((t) => t !== type)
                )
              }}
            >
              {type}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              'min-w-[120px] justify-start text-left font-normal',
              !date && 'text-muted-foreground'
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date?.from ? (
              date.to ? (
                <>
                  {format(date.from, 'LLL dd')} - {format(date.to, 'LLL dd')}
                </>
              ) : (
                format(date.from, 'LLL dd')
              )
            ) : (
              <span>Date range</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={date?.from}
            selected={date}
            onSelect={onDateChange}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
})

// Add a new skeleton component for file cards
const FileCardSkeleton = () => (
  <div className="rounded-xl border bg-card text-card-foreground shadow">
    {/* Preview Section */}
    <div className="relative">
      <div className="relative aspect-square bg-muted animate-pulse rounded-t-xl overflow-hidden" />

      {/* Skeleton overlay for actions */}
      <div className="absolute inset-0 bg-black/50 opacity-0 transition-opacity flex flex-col items-center justify-center gap-3">
        <div className="h-8 w-16 bg-muted/20 rounded animate-pulse" />
        <div className="flex gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-8 w-8 bg-muted/20 rounded animate-pulse"
            />
          ))}
        </div>
      </div>

      {/* Status badge skeleton */}
      <div className="absolute bottom-2 left-2">
        <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-background/80 backdrop-blur-sm">
          <div className="h-3 w-3 bg-muted-foreground/20 rounded animate-pulse" />
          <div className="h-3 w-12 bg-muted-foreground/20 rounded animate-pulse" />
        </div>
      </div>

      {/* Upload time badge skeleton */}
      <div className="absolute bottom-2 right-2">
        <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-background/80 backdrop-blur-sm">
          <div className="h-3 w-3 bg-muted-foreground/20 rounded animate-pulse" />
          <div className="h-3 w-8 bg-muted-foreground/20 rounded animate-pulse" />
        </div>
      </div>
    </div>

    {/* File info section skeleton */}
    <div className="p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="h-[18px] w-3/4 bg-muted rounded animate-pulse" />
        <div className="h-[18px] w-12 bg-muted rounded animate-pulse" />
      </div>
    </div>
  </div>
)

// Add skeleton pagination component
const PaginationSkeleton = () => (
  <div className="flex justify-center mt-8">
    <div className="flex items-center gap-2">
      <div className="h-9 w-9 rounded-md bg-muted animate-pulse" />
      <div className="h-9 w-9 rounded-md bg-muted animate-pulse" />
      <div className="h-9 w-9 rounded-md bg-muted animate-pulse" />
      <div className="h-9 w-9 rounded-md bg-muted animate-pulse" />
      <div className="h-9 w-9 rounded-md bg-muted animate-pulse" />
    </div>
  </div>
)

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

  // Use the useFileFilters hook
  const {
    filters,
    setSearch,
    setTypes,
    setDateRange,
    setVisibility,
    setSortBy,
    setPage,
  } = useFileFilters()

  // Handle date range changes with the DateRange object
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

  // Fetch file types
  useEffect(() => {
    async function fetchFileTypes() {
      try {
        const response = await fetch('/api/files/types')
        if (!response.ok) throw new Error('Failed to fetch file types')
        const data = await response.json()
        setFileTypes(data.types)
      } catch (error) {
        console.error('Error fetching file types:', error)
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
        const data = await response.json()
        setFiles(data.files)
        setPaginationInfo({
          total: data.pagination.total,
          pageCount: data.pagination.pageCount,
          page: filters.page,
          limit: filters.limit,
        })
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

  // Create derived values for UI components
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
            {Array.from({ length: 24 }).map((_, i) => (
              <FileCardSkeleton key={i} />
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
        {paginationInfo.pageCount > 1 && (
          <div className="flex justify-center mt-8">
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      if (paginationInfo.page > 1) {
                        setPage(paginationInfo.page - 1)
                      }
                    }}
                    className={
                      paginationInfo.page <= 1
                        ? 'pointer-events-none opacity-50'
                        : ''
                    }
                  />
                </PaginationItem>
                {Array.from({ length: paginationInfo.pageCount }).map(
                  (_, i) => {
                    const pageNumber = i + 1
                    // Show first page, last page, and 2 pages around current page
                    if (
                      pageNumber === 1 ||
                      pageNumber === paginationInfo.pageCount ||
                      (pageNumber >= paginationInfo.page - 2 &&
                        pageNumber <= paginationInfo.page + 2)
                    ) {
                      return (
                        <PaginationItem key={pageNumber}>
                          <PaginationLink
                            href="#"
                            onClick={(e) => {
                              e.preventDefault()
                              setPage(pageNumber)
                            }}
                            isActive={pageNumber === paginationInfo.page}
                          >
                            {pageNumber}
                          </PaginationLink>
                        </PaginationItem>
                      )
                    } else if (
                      // Show ellipsis only when there's a gap
                      (pageNumber === 2 && paginationInfo.page - 2 > 2) ||
                      (pageNumber === paginationInfo.pageCount - 1 &&
                        paginationInfo.page + 2 < paginationInfo.pageCount - 1)
                    ) {
                      return (
                        <PaginationItem key={pageNumber}>
                          <PaginationEllipsis />
                        </PaginationItem>
                      )
                    }
                    return null
                  }
                )}
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      if (paginationInfo.page < paginationInfo.pageCount) {
                        setPage(paginationInfo.page + 1)
                      }
                    }}
                    className={
                      paginationInfo.page >= paginationInfo.pageCount
                        ? 'pointer-events-none opacity-50'
                        : ''
                    }
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        )}
      </>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4">
        <SearchInput onSearch={setSearch} />
        <Filters
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
      {renderContent()}
    </div>
  )
}
