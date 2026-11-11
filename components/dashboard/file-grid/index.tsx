import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import Link from 'next/link'

import type { FileType } from '@/types/components/file'
import { useQueryClient } from '@tanstack/react-query'
import { endOfDay, format } from 'date-fns'
import {
  AlertCircle,
  CheckSquare,
  FolderOpen,
  RefreshCw,
  SearchX,
  Tag,
  Upload,
  X,
} from 'lucide-react'
import type { DateRange } from 'react-day-picker'

import { ArchiveBrowserDialog } from '@/components/archives/archive-browser-dialog'
import {
  type ArchiveFileRef,
  isArchiveCandidate,
} from '@/components/archives/archive-utils'
import { CreateArchiveDialog } from '@/components/archives/create-archive-dialog'
import { FileCard } from '@/components/dashboard/file-card'
import {
  BATCH_ACTIONS,
  type BatchAction,
  FILE_ACTIONS,
  fileActionAllowed,
} from '@/components/dashboard/file-card/actions'
import { FileCardSkeleton } from '@/components/dashboard/file-grid/file-card-skeleton'
import { FileFilters } from '@/components/dashboard/file-grid/file-filters'
import { SearchInput } from '@/components/dashboard/file-grid/search-input'
import { VirtualFiles } from '@/components/dashboard/file-grid/virtual-files'
import { ImageLightbox } from '@/components/file/image-lightbox'
import { FolderBrowser } from '@/components/folders/folder-browser'
import { MoveFilesDialog } from '@/components/folders/move-files-dialog'
import { PageHeader, pagePanelClassName } from '@/components/layout/page-header'
import { FileTagsDialog } from '@/components/tags/file-tags-dialog'
import { TagFilter } from '@/components/tags/tag-filter'
import { TagManager } from '@/components/tags/tag-manager'
import { Button } from '@/components/ui/button'

import { fileTypeLabel } from '@/lib/files/file-kind'
import { fileUrls } from '@/lib/files/urls'
import {
  LIBRARY_LISTS,
  libraryChanged,
  onLibraryChange,
} from '@/lib/library/changes'
import {
  BATCH_LIMIT,
  DEFAULT_SORT,
  UNFILED,
  UNTAGGED,
  VISIBILITY_FILTERS,
  folderDestination,
  isDateOrder,
  librarySort,
  uploadHref,
} from '@/lib/library/contract'
import { allows } from '@/lib/permissions/actions'
import type { PermissionSubject } from '@/lib/permissions/catalog'

import { SessionScoped, useAccountQuery } from '@/hooks/use-account-query'
import { useFileFilters } from '@/hooks/use-file-filters'
import { useFileLibraryPosition } from '@/hooks/use-file-library-position'
import { useFileTimeline } from '@/hooks/use-file-timeline'
import { useFolders } from '@/hooks/use-folders'
import { useFreshFileSelection } from '@/hooks/use-fresh-file-selection'
import { useHydrated } from '@/hooks/use-hydrated'
import { useImageGallery } from '@/hooks/use-image-gallery'
import { usePermissions } from '@/hooks/use-permissions'
import {
  RequestLifetimeProvider,
  useRequestLifetime,
} from '@/hooks/use-request-lifetime'
import { useTags } from '@/hooks/use-tags'
import { toast } from '@/hooks/use-toast'

/** Every constraint is removable on its own, without losing the current scope. */
function FilterChip({
  label,
  onRemove,
  children,
}: {
  label: string
  onRemove: () => void
  children?: ReactNode
}) {
  return (
    <button
      data-flare-control
      type="button"
      onClick={onRemove}
      aria-label={`Remove ${label} filter`}
      title={label}
      className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-lg border border-border/60 bg-muted px-2.5 py-1 text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {children}
      <span className="truncate">{label}</span>
      <X className="h-3 w-3 shrink-0" aria-hidden="true" />
    </button>
  )
}

function emptyFolderHint(user: PermissionSubject | null | undefined) {
  const upload = allows(user, ['uploadFiles', 'fileIntoFolder'])
  const move = allows(user, 'moveFiles')
  if (upload && move)
    return 'Upload here, or move existing files from their menu or a selection in All files.'
  if (upload) return 'Upload here to add files.'
  if (move)
    return 'Move existing files here from their menu or a selection in All files.'
  return 'Your role can’t add files to folders.'
}

export function FileGrid() {
  // Replacing an account or browser session discards every retained card,
  // selection, dialog, gallery and pending action together before rendering.
  return (
    <SessionScoped
      loading={<p role="status">Loading files…</p>}
      signedOut={<p role="status">Sign in to view your files.</p>}
    >
      {(scope) => <AccountFileGrid scope={scope.key} />}
    </SessionScoped>
  )
}

function AccountFileGrid({ scope }: { scope: string }) {
  const lifetime = useRequestLifetime()
  return (
    <RequestLifetimeProvider lifetime={lifetime}>
      <FileLibrary scope={scope} />
    </RequestLifetimeProvider>
  )
}

function FileLibrary({ scope }: { scope: string }) {
  const hydrated = useHydrated()
  const lifetime = useRequestLifetime()
  const client = useQueryClient()
  const { user } = usePermissions()
  const libraryHeading = useRef<HTMLHeadingElement>(null)
  const selectionBar = useRef<HTMLDivElement>(null)
  const [files, setFiles] = useState<FileType[]>([])
  const [selectedFiles, setSelectedFiles] = useState<FileType[]>([])
  const [refreshKey, setRefreshKey] = useState(0)
  // A library change, made here or anywhere else, reloads these files once;
  // the same change reloads the tag, folder and file type lists.
  useEffect(
    () => onLibraryChange(() => setRefreshKey((value) => value + 1)),
    []
  )
  const refreshFiles = useCallback(() => void libraryChanged(client), [client])
  const fileTypes = useAccountQuery<{ types?: unknown }>(
    LIBRARY_LISTS.fileTypes,
    '/api/files/types',
    // Suggestions are optional; the library stays searchable without them.
    { retry: false }
  ).data?.types
  const [managingTags, setManagingTags] = useState(false)
  const [taggingFiles, setTaggingFiles] = useState<FileType[] | null>(null)
  const [movingFiles, setMovingFiles] = useState<FileType[] | null>(null)
  const [browsingArchive, setBrowsingArchive] = useState<ArchiveFileRef | null>(
    null
  )
  const [creatingArchive, setCreatingArchive] = useState<FileType[] | null>(
    null
  )
  const [selecting, setSelecting] = useState(false)
  const selectedIds = selectedFiles.map((file) => file.id)
  const allVisibleSelected =
    files.length > 0 && files.every((file) => selectedIds.includes(file.id))
  const someVisibleSelected = files.some((file) =>
    selectedIds.includes(file.id)
  )
  // "Select visible files" shows a dash when only some are selected. Set
  // after every render: a click clears the browser's flag even when the
  // selection, and so the values here, stay the same (at the batch limit).
  const selectVisibleRef = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    if (selectVisibleRef.current)
      selectVisibleRef.current.indeterminate =
        !allVisibleSelected && someVisibleSelected
  })
  const clearSelection = () => setSelectedFiles([])
  const { tags } = useTags()
  const {
    folders,
    loading: foldersLoading,
    error: foldersError,
    reload: reloadFolders,
  } = useFolders()
  const {
    filters,
    pathname,
    urlQuery,
    setFolder,
    setTag,
    setSearch,
    setTypes,
    setDateRange,
    setVisibility,
    setSortBy,
    setGroupBy,
    resetFilters,
  } = useFileFilters()
  const { position: anchorIndex, record: recordPosition } =
    useFileLibraryPosition(filters, pathname, urlQuery, refreshFiles, scope)
  const library = useFileTimeline(filters, refreshKey, scope)
  const selection = useFreshFileSelection(selectedFiles, [scope, filters])
  const openSelection = async (action: BatchAction) => {
    const { signal } = lifetime.current
    if (signal.aborted) return
    try {
      const fresh = await selection.refresh()
      if (!fresh || signal.aborted) return
      setSelectedFiles(fresh)
      if (action === 'editTags') setTaggingFiles(fresh)
      if (action === 'move') setMovingFiles(fresh)
      if (action === 'createArchive') setCreatingArchive(fresh)
    } catch (error) {
      if (signal.aborted) return
      toast({
        title: 'Couldn’t open selected files',
        description:
          error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    }
  }
  const { timeline, isLoading, error } = library
  useEffect(() => {
    if (!timeline?.total) setFiles((current) => (current.length ? [] : current))
  }, [timeline])
  const total = timeline?.total ?? 0
  const onVisibleFiles = useCallback(
    (visible: FileType[], firstIndex: number) => {
      if (visible.length) recordPosition(firstIndex)
      setFiles((previous) =>
        previous.length === visible.length &&
        previous.every((file, index) => file === visible[index])
          ? previous
          : visible
      )
    },
    [recordPosition]
  )
  const toggleFile = (file: FileType) => {
    if (!selectedIds.includes(file.id) && selectedFiles.length >= BATCH_LIMIT) {
      toast({
        title: `Select up to ${BATCH_LIMIT} files at a time`,
        description: 'Finish this action, then select more files.',
      })
      return
    }
    setSelectedFiles((current) =>
      current.some((entry) => entry.id === file.id)
        ? current.filter((entry) => entry.id !== file.id)
        : [...current, file]
    )
  }
  const {
    gallery,
    open,
    close,
    move,
    setIndex,
    navigationPending,
    navigationStale,
  } = useImageGallery(filters, files, refreshKey)
  const hasActiveFilters = Boolean(
    filters.tag ||
    filters.search ||
    filters.types.length ||
    filters.visibility.length ||
    filters.dateFrom ||
    filters.dateTo
  )
  const activeTagName =
    filters.tag === UNTAGGED
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
    setSelectedFiles([])
  }, [filters])

  const handleDateChange = useCallback(
    (range: DateRange | undefined) => {
      setDateRange(
        range?.from?.toISOString() || null,
        range?.to ? endOfDay(range.to).toISOString() : null
      )
    },
    [setDateRange]
  )

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
        className={pagePanelClassName}
      >
        <PageHeader
          className="mb-4 border-0 pb-0"
          actionsBesideTitle
          headingRef={libraryHeading}
          title="Your files"
          description="View and manage your uploaded files."
          actions={
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2"
                disabled={
                  (!selecting && !files.length) ||
                  !BATCH_ACTIONS.some((action) =>
                    fileActionAllowed(user, action)
                  )
                }
                onClick={() => {
                  setSelecting(!selecting)
                  clearSelection()
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
                    : `${total.toLocaleString()} ${total === 1 ? 'file' : 'files'}`}
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
            </>
          }
        />
        <div className="flex flex-col gap-3 lg:flex-row">
          <SearchInput onSearch={setSearch} initialValue={filters.search} />
          <FileFilters
            hasTagFilter={Boolean(filters.tag)}
            sortBy={filters.sortBy}
            onSortChange={setSortBy}
            selectedTypes={filters.types}
            onTypesChange={setTypes}
            fileTypes={Array.isArray(fileTypes) ? fileTypes : []}
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
          filters.sortBy !== DEFAULT_SORT ||
          filters.groupBy !== 'none') && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {filters.tag && (
              <FilterChip label={activeTagName} onRemove={() => setTag(null)}>
                <Tag className="h-3 w-3 shrink-0" aria-hidden="true" />
              </FilterChip>
            )}
            {filters.search && (
              <FilterChip
                label={`Search: ${filters.search}`}
                onRemove={() => setSearch('')}
              />
            )}
            {filters.types.map((type) => (
              <FilterChip
                key={type}
                label={fileTypeLabel(type)}
                onRemove={() =>
                  setTypes(filters.types.filter((entry) => entry !== type))
                }
              />
            ))}
            {filters.visibility.map((value) => (
              <FilterChip
                key={value}
                label={
                  VISIBILITY_FILTERS.find((filter) => filter.value === value)
                    ?.label || value
                }
                onRemove={() =>
                  setVisibility(
                    filters.visibility.filter((entry) => entry !== value)
                  )
                }
              />
            ))}
            {(filters.dateFrom || filters.dateTo) && (
              <FilterChip
                label={
                  hydrated
                    ? filters.dateFrom && filters.dateTo
                      ? `Uploaded ${format(new Date(filters.dateFrom), 'MMM d, yyyy')} – ${format(new Date(filters.dateTo), 'MMM d, yyyy')}`
                      : filters.dateFrom
                        ? `Uploaded from ${format(new Date(filters.dateFrom), 'MMM d, yyyy')}`
                        : `Uploaded through ${format(new Date(filters.dateTo!), 'MMM d, yyyy')}`
                    : 'Upload date'
                }
                onRemove={() => setDateRange(null, null)}
              />
            )}
            {filters.groupBy !== 'none' && (
              <FilterChip
                label={`Grouped by ${filters.groupBy}`}
                onRemove={() => setGroupBy('none')}
              />
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-lg text-xs"
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
        <div
          ref={selectionBar}
          aria-busy={selection.loading}
          className="sticky top-24 z-30 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-overlay px-4 py-3 shadow-lg shadow-black/20"
        >
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={allVisibleSelected}
              ref={selectVisibleRef}
              disabled={isLoading || !files.length}
              onChange={(event) =>
                setSelectedFiles((current) =>
                  event.target.checked
                    ? [
                        ...current,
                        ...files.filter(
                          (file) =>
                            !current.some((entry) => entry.id === file.id)
                        ),
                      ].slice(0, BATCH_LIMIT)
                    : current.filter(
                        (file) => !files.some((entry) => entry.id === file.id)
                      )
                )
              }
            />
            Select visible files
          </label>
          <span className="text-xs text-muted-foreground" role="status">
            {selectedIds.length} selected · up to {BATCH_LIMIT}
            {selection.loading && ' · Refreshing selection…'}
          </span>
          {/* Phones lay the actions out in two equal columns, so wrapped
              rows share their edges. */}
          <div className="grid w-full grid-cols-2 gap-2 sm:ml-auto sm:flex sm:w-auto sm:flex-wrap sm:items-center">
            {BATCH_ACTIONS.map((action) => {
              if (!fileActionAllowed(user, action)) return null
              const { icon: Icon, batch } = FILE_ACTIONS[action]
              return (
                <Button
                  key={action}
                  size="sm"
                  variant="outline"
                  disabled={
                    !selectedIds.length || isLoading || selection.loading
                  }
                  onClick={() => void openSelection(action)}
                >
                  <Icon className="mr-2 h-4 w-4" />
                  {batch}
                </Button>
              )
            })}
            {/* The bar stays in view while the header scrolls away. */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelecting(false)
                clearSelection()
              }}
            >
              Done
            </Button>
          </div>
        </div>
      )}

      {isLoading && !gallery ? (
        <div
          aria-busy="true"
          aria-label="Loading files"
          className="mr-6 grid gap-4 sm:mr-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 min-[1360px]:mr-0"
        >
          {Array.from({ length: 8 }, (_, index) => (
            <FileCardSkeleton key={index} />
          ))}
        </div>
      ) : error && !gallery ? (
        <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-border/60 bg-panel p-6 text-center">
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
      ) : timeline?.total === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border/60 bg-panel p-6 text-center">
          <div className="mb-4 rounded-xl bg-primary/10 p-3 text-primary">
            {hasActiveFilters ? (
              <SearchX className="h-7 w-7" />
            ) : (
              <FolderOpen className="h-7 w-7" />
            )}
          </div>
          <h2 className="text-xl font-semibold">
            {onlyTagFilter
              ? filters.tag === UNTAGGED
                ? 'Every file has a tag'
                : `No files tagged “${activeTagName}” yet`
              : hasActiveFilters
                ? 'No files match your search'
                : filters.folder === UNFILED
                  ? 'Everything has a home'
                  : filters.folder
                    ? 'No files in this folder yet'
                    : 'No files uploaded'}
          </h2>
          <p className="mb-6 mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            {onlyTagFilter
              ? filters.tag === UNTAGGED
                ? 'All your files are still together in your vault.'
                : 'Add this tag from a file’s menu, select several files, or give it an automatic rule in Manage tags.'
              : hasActiveFilters
                ? 'Try another file name or reset your filters to see everything in your library.'
                : filters.folder === UNFILED
                  ? 'All your files are organized into folders. You can always find them in All files.'
                  : filters.folder
                    ? emptyFolderHint(user)
                    : 'Upload your first file to get started.'}
          </p>
          {hasActiveFilters ? (
            <Button
              variant="outline"
              onClick={onlyTagFilter ? () => setTag(null) : resetFilters}
            >
              {onlyTagFilter ? 'All files' : 'Reset filters'}
            </Button>
          ) : filters.folder === UNFILED ? (
            <Button variant="outline" onClick={() => setFolder(null)}>
              All files
            </Button>
          ) : (
            allows(
              user,
              filters.folder ? ['uploadFiles', 'fileIntoFolder'] : 'uploadFiles'
            ) && (
              <Button asChild>
                <Link href={uploadHref(filters.folder)}>
                  <Upload className="mr-2 h-4 w-4" />
                  {filters.folder ? 'Upload here' : 'Upload your first file'}
                </Link>
              </Button>
            )
          )}
        </div>
      ) : (
        timeline && (
          <VirtualFiles
            library={library}
            selectionBarRef={selectionBar}
            initialIndex={anchorIndex.current}
            chronological={isDateOrder(librarySort(filters.sortBy))}
            onVisibleFiles={onVisibleFiles}
            onRefresh={refreshFiles}
            renderFile={(file) => (
              <FileCard
                key={`${file.id}:${refreshKey}`}
                file={file}
                onDelete={(id) => {
                  setSelectedFiles((current) =>
                    current.filter((entry) => entry.id !== id)
                  )
                  refreshFiles()
                }}
                onUpdate={refreshFiles}
                onPreview={open}
                onBrowseArchive={
                  isArchiveCandidate(file.name, file.mimeType)
                    ? () => setBrowsingArchive(file)
                    : undefined
                }
                onEditTags={() => setTaggingFiles([file])}
                onMove={() => setMovingFiles([file])}
                folder={
                  // Inside a folder, every card would repeat the open folder.
                  file.folderId === filters.folder
                    ? undefined
                    : folders.find((folder) => folder.id === file.folderId)
                }
                onFolderSelect={setFolder}
                onTagSelect={setTag}
                selected={selectedIds.includes(file.id)}
                onSelect={selecting ? () => toggleFile(file) : undefined}
              />
            )}
          />
        )
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
            clearSelection()
          }}
        />
      )}
      {browsingArchive && (
        <ArchiveBrowserDialog
          key={browsingArchive.id}
          file={browsingArchive}
          onClose={() => setBrowsingArchive(null)}
        />
      )}
      {creatingArchive && (
        <CreateArchiveDialog
          files={creatingArchive}
          initialFolderId={folderDestination(filters.folder)}
          onClose={() => {
            setCreatingArchive(null)
            clearSelection()
          }}
          onOpenArchive={setBrowsingArchive}
        />
      )}
      {taggingFiles && (
        <FileTagsDialog
          files={taggingFiles}
          onClose={() => {
            setTaggingFiles(null)
            clearSelection()
          }}
          onChanged={(updated) => {
            setTaggingFiles(updated)
            setSelectedFiles((current) =>
              current.map(
                (file) => updated.find((entry) => entry.id === file.id) || file
              )
            )
          }}
        />
      )}
      {gallery && (
        <ImageLightbox
          images={gallery.files.map((file) => {
            const urls = fileUrls(file)
            return {
              id: file.id,
              name: file.name,
              src: urls.thumbnail,
              downloadUrl: urls.download,
              shareUrl: urls.page,
              subtitle: format(new Date(file.uploadedAt), 'MMMM d, yyyy'),
            }
          })}
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
            gallery.pagination
              ? `${gallery.pagination.offset + gallery.index + 1} of ${gallery.pagination.total}`
              : gallery.files[gallery.index].name
          }
        />
      )}
    </div>
  )
}
