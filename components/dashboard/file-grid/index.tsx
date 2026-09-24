import { useCallback, useEffect, useRef, useState } from 'react'

import Link from 'next/link'

import type { FileType, PaginationInfo } from '@/types/components/file'
import { endOfDay, format } from 'date-fns'
import {
  AlertCircle,
  CheckSquare,
  FolderInput,
  FolderOpen,
  RefreshCw,
  SearchX,
  Tag,
  Upload,
  X,
} from 'lucide-react'
import type { DateRange } from 'react-day-picker'

import { FileCard } from '@/components/dashboard/file-card'
import { FileCardSkeleton } from '@/components/dashboard/file-grid/file-card-skeleton'
import { FileFilters } from '@/components/dashboard/file-grid/file-filters'
import { FileGridPagination } from '@/components/dashboard/file-grid/pagination'
import { SearchInput } from '@/components/dashboard/file-grid/search-input'
import { ImageLightbox } from '@/components/file/image-lightbox'
import { FolderBrowser } from '@/components/folders/folder-browser'
import { MoveFilesDialog } from '@/components/folders/move-files-dialog'
import { FileTagsDialog } from '@/components/tags/file-tags-dialog'
import { TagFilter } from '@/components/tags/tag-filter'
import { TagManager } from '@/components/tags/tag-manager'
import { Button } from '@/components/ui/button'

import { fileQuery, groupFiles } from '@/lib/files/gallery'

import { useFileFilters } from '@/hooks/use-file-filters'
import { useFolders } from '@/hooks/use-folders'
import { useImageGallery } from '@/hooks/use-image-gallery'
import { useTags } from '@/hooks/use-tags'

export function FileGrid() {
  const libraryHeading = useRef<HTMLHeadingElement>(null)
  const [files, setFiles] = useState<FileType[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [fileTypes, setFileTypes] = useState<string[]>([])
  const [managingTags, setManagingTags] = useState(false)
  const [taggingFiles, setTaggingFiles] = useState<FileType[] | null>(null)
  const [movingFiles, setMovingFiles] = useState<FileType[] | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const { tags, reload: reloadTags } = useTags()
  const {
    folders,
    loading: foldersLoading,
    error: foldersError,
    reload: reloadFolders,
  } = useFolders()
  const [paginationInfo, setPaginationInfo] = useState<PaginationInfo>({
    total: 0,
    pageCount: 0,
    page: 1,
    limit: 24,
  })
  const {
    filters,
    setFolder,
    setTag,
    setSearch,
    setTypes,
    setDateRange,
    setVisibility,
    setSortBy,
    setGroupBy,
    setPage,
    resetFilters,
  } = useFileFilters()
  const {
    gallery,
    open,
    close,
    move,
    setIndex,
    navigationPending,
    navigationStale,
  } = useImageGallery(filters, files, paginationInfo, refreshKey)
  const imagesOnly =
    filters.types.length > 0 &&
    filters.types.every((type) => type.startsWith('image/'))
  const refreshFiles = useCallback(
    () => setRefreshKey((value) => value + 1),
    []
  )
  const hasActiveFilters = Boolean(
    filters.tag ||
    filters.search ||
    filters.types.length ||
    filters.visibility.length ||
    filters.dateFrom ||
    filters.dateTo
  )
  const activeTagName =
    filters.tag === 'untagged'
      ? 'Untagged'
      : tags.find((tag) => tag.id === filters.tag)?.name || 'Selected tag'
  const onlyTagFilter =
    !!filters.tag &&
    !filters.search &&
    !filters.types.length &&
    !filters.visibility.length &&
    !filters.dateFrom &&
    !filters.dateTo

  useEffect(() => {
    setSelectedIds([])
  }, [filters])

  useEffect(() => {
    void reloadTags()
  }, [refreshKey, reloadTags])

  useEffect(() => {
    void reloadFolders()
  }, [refreshKey, reloadFolders])

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
        const params = fileQuery(filters)
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
        const nextFiles: FileType[] = Array.isArray(result.data)
          ? result.data
          : []
        setFiles(nextFiles)
        setSelectedIds((ids) =>
          ids.filter((id) => nextFiles.some((file) => file.id === id))
        )
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
            <h1
              ref={libraryHeading}
              tabIndex={-1}
              className="text-3xl font-bold"
            >
              Your Files
            </h1>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2"
                disabled={!selecting && !files.length}
                onClick={() => {
                  setSelecting(!selecting)
                  setSelectedIds([])
                }}
                aria-pressed={selecting}
                aria-label={
                  selecting ? 'Finish selecting files' : 'Select files'
                }
              >
                <CheckSquare className="h-4 w-4" />
                <span className="hidden sm:inline">
                  {selecting ? 'Done' : 'Select'}
                </span>
              </Button>
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
            groupBy={filters.groupBy}
            onGroupChange={setGroupBy}
            visibility={filters.visibility}
            onVisibilityChange={setVisibility}
            tagFilter={
              <TagFilter
                value={filters.tag || null}
                onChange={setTag}
                onManage={() => setManagingTags(true)}
              />
            }
          />
        </div>
        {(hasActiveFilters ||
          filters.sortBy !== 'newest' ||
          filters.groupBy !== 'none') && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {filters.tag && (
              <button
                type="button"
                onClick={() => setTag(null)}
                aria-label={`Remove ${activeTagName} filter`}
                className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1 text-xs text-primary focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Tag className="h-3 w-3 shrink-0" />
                <span className="truncate">{activeTagName}</span>
                <X className="h-3 w-3 shrink-0" />
              </button>
            )}
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
            {filters.groupBy !== 'none' && (
              <span className="rounded-lg bg-muted px-2.5 py-1 text-xs">
                Grouped by {filters.groupBy}
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
        <FolderBrowser
          folders={folders}
          value={filters.folder ?? null}
          onChange={setFolder}
          loading={foldersLoading}
          error={foldersError}
          onRetry={() => void reloadFolders()}
        />
      </section>

      {selecting && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-background/80 px-4 py-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={
                files.length > 0 &&
                files.every((file) => selectedIds.includes(file.id))
              }
              disabled={isLoading || !files.length}
              onChange={(event) =>
                setSelectedIds(
                  event.target.checked ? files.map((file) => file.id) : []
                )
              }
            />
            Select this page
          </label>
          <span className="text-xs text-muted-foreground" role="status">
            {selectedIds.length} selected
          </span>
          <Button
            size="sm"
            className="ml-auto"
            variant="outline"
            disabled={!selectedIds.length || isLoading}
            onClick={() =>
              setMovingFiles(
                files.filter((file) => selectedIds.includes(file.id))
              )
            }
          >
            <FolderInput className="mr-2 h-4 w-4" />
            Move
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!selectedIds.length || isLoading}
            onClick={() =>
              setTaggingFiles(
                files.filter((file) => selectedIds.includes(file.id))
              )
            }
          >
            <Tag className="mr-2 h-4 w-4" />
            Edit tags
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelecting(false)
              setSelectedIds([])
            }}
          >
            Done
          </Button>
        </div>
      )}

      {isLoading && !gallery ? (
        <div
          aria-busy="true"
          aria-label="Loading files"
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {Array.from({ length: 8 }, (_, index) => (
            <FileCardSkeleton key={index} />
          ))}
        </div>
      ) : error && !gallery ? (
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
            {onlyTagFilter
              ? filters.tag === 'untagged'
                ? 'Every file has a tag'
                : `No files tagged “${activeTagName}” yet`
              : hasActiveFilters
                ? 'No files match your search'
                : filters.folder === 'unfiled'
                  ? 'Everything has a home'
                  : filters.folder
                    ? 'No files in this folder yet'
                    : 'No files uploaded'}
          </h2>
          <p className="mb-6 mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            {onlyTagFilter
              ? filters.tag === 'untagged'
                ? 'All your files are still together in your vault.'
                : 'Add this tag from a file’s menu, select several files, or give it an automatic rule in Manage tags.'
              : hasActiveFilters
                ? 'Try another file name or reset your filters to see everything in your library.'
                : filters.folder === 'unfiled'
                  ? 'All your files are organized into folders. You can always find them in All files.'
                  : filters.folder
                    ? 'Upload here, or move existing files from their menu or a selection in All files.'
                    : 'Upload your first file to get started.'}
          </p>
          {hasActiveFilters ? (
            <Button
              variant="outline"
              onClick={onlyTagFilter ? () => setTag(null) : resetFilters}
            >
              {onlyTagFilter ? 'All files' : 'Reset filters'}
            </Button>
          ) : filters.folder === 'unfiled' ? (
            <Button variant="outline" onClick={() => setFolder(null)}>
              All files
            </Button>
          ) : (
            <Button asChild>
              <Link
                href={
                  filters.folder
                    ? `/dashboard/upload?folder=${filters.folder}`
                    : '/dashboard/upload'
                }
              >
                <Upload className="mr-2 h-4 w-4" />
                {filters.folder ? 'Upload here' : 'Upload your first file'}
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-7">
            {groupFiles(files, filters.groupBy).map((group) => (
              <section key={group.label} aria-label={group.label || undefined}>
                {group.label && (
                  <h2 className="mb-3 text-sm font-medium text-muted-foreground">
                    {group.label}
                  </h2>
                )}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {group.files.map((file) => (
                    <FileCard
                      key={file.id}
                      file={file}
                      onDelete={refreshFiles}
                      onUpdate={refreshFiles}
                      onPreview={open}
                      onEditTags={() => setTaggingFiles([file])}
                      onMove={() => setMovingFiles([file])}
                      folder={folders.find(
                        (folder) => folder.id === file.folderId
                      )}
                      onFolderSelect={setFolder}
                      onTagSelect={setTag}
                      selected={selectedIds.includes(file.id)}
                      onSelect={
                        selecting
                          ? () =>
                              setSelectedIds((ids) =>
                                ids.includes(file.id)
                                  ? ids.filter((id) => id !== file.id)
                                  : [...ids, file.id]
                              )
                          : undefined
                      }
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
          <FileGridPagination
            paginationInfo={paginationInfo}
            setPage={setPage}
          />
        </>
      )}
      <TagManager
        open={managingTags}
        onOpenChange={setManagingTags}
        onDeleted={(id) => {
          if (filters.tag === id) setTag(null)
        }}
      />
      {movingFiles && (
        <MoveFilesDialog
          files={movingFiles}
          onClose={() => {
            setMovingFiles(null)
            setSelectedIds([])
          }}
        />
      )}
      {taggingFiles && (
        <FileTagsDialog
          files={taggingFiles}
          onClose={() => {
            setTaggingFiles(null)
            setSelectedIds([])
          }}
          onChanged={(updated) => {
            setTaggingFiles(updated)
            setFiles((current) =>
              current.map(
                (file) => updated.find((entry) => entry.id === file.id) || file
              )
            )
          }}
        />
      )}
      {gallery && (
        <ImageLightbox
          images={gallery.files.map((file) => ({
            id: file.id,
            name: file.name,
            src: `/api/files/${file.id}/thumbnail`,
            downloadUrl: `/api/files/${file.id}/download`,
            subtitle: format(new Date(file.uploadedAt), 'MMMM d, yyyy'),
          }))}
          index={gallery.index}
          onIndexChange={setIndex}
          onClose={close}
          fallbackFocusRef={libraryHeading}
          onPrevious={() => void move(-1)}
          onNext={() => void move(1)}
          hasPrevious={navigationStale || gallery.index > 0 || !gallery.atStart}
          hasNext={
            navigationStale ||
            gallery.index < gallery.files.length - 1 ||
            !gallery.atEnd
          }
          navigationPending={navigationPending}
          positionLabel={
            imagesOnly || gallery.pagination.offset !== undefined
              ? `${(gallery.pagination.offset ?? (gallery.pagination.page - 1) * gallery.pagination.limit) + gallery.index + 1} of ${gallery.pagination.total}`
              : `Image ${gallery.index + 1} · Page ${gallery.pagination.page}`
          }
        />
      )}
    </div>
  )
}
