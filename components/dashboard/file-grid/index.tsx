'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import type {
  FileType,
  PaginationInfo,
  SortOption,
} from '@/types/components/file'
import type { FolderTreeNode } from '@/types/components/folder'
import type { DateRange } from 'react-day-picker'

import { BulkActionsBar } from '@/components/dashboard/bulk-actions-bar'
import { FileCard } from '@/components/dashboard/file-card'
import { FileCardSkeleton } from '@/components/dashboard/file-grid/file-card-skeleton'
import { FileFilters } from '@/components/dashboard/file-grid/file-filters'
import { FileListView } from '@/components/dashboard/file-grid/list-view'
import {
  FileGridPagination,
  PaginationSkeleton,
} from '@/components/dashboard/file-grid/pagination'
import { SearchInput } from '@/components/dashboard/file-grid/search-input'
import { ViewSwitcher } from '@/components/dashboard/file-grid/view-switcher'
import { FolderBreadcrumb } from '@/components/dashboard/folder/folder-breadcrumb'
import { FolderCard } from '@/components/dashboard/folder/folder-card'
import { FolderDialog } from '@/components/dashboard/folder/folder-dialog'
import { FolderFilter } from '@/components/dashboard/folder/folder-filter'
import { FolderSidebar } from '@/components/dashboard/folder/folder-sidebar'
import { MoveToFolderDialog } from '@/components/dashboard/folder/move-to-folder-dialog'
import { EditTagsDialog } from '@/components/dashboard/file/edit-tags-dialog'
import { ManageTagsDialog } from '@/components/dashboard/tag/manage-tags-dialog'
import { TagFilter } from '@/components/dashboard/tag/tag-filter'
import { EmptyPlaceholder } from '@/components/shared/empty-placeholder'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

import { getDescendantIds, getBreadcrumb } from '@/lib/folders/tree'

import { useFileFilters } from '@/hooks/use-file-filters'
import { useFileSelection } from '@/hooks/use-file-selection'
import { useFolders } from '@/hooks/use-folders'
import { useTags } from '@/hooks/use-tags'
import { useToast } from '@/hooks/use-toast'

interface FileGridProps {
  organizationEnabled?: boolean
}

function findNode(
  nodes: FolderTreeNode[],
  id: string
): FolderTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findNode(node.children, id)
    if (found) return found
  }
  return null
}

export function FileGrid({ organizationEnabled = false }: FileGridProps) {
  const { toast } = useToast()
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
    setFolderId,
    setTags,
    setViewMode,
  } = useFileFilters()

  const {
    folders,
    tree,
    createFolder,
    updateFolder,
    deleteFolder,
    refetch: refetchFolders,
  } = useFolders({ enabled: organizationEnabled })
  const {
    tags,
    createTag,
    updateTag,
    deleteTag,
    refetch: refetchTags,
  } = useTags({ enabled: organizationEnabled })

  const selection = useFileSelection()

  // Dialog state.
  const [createParentId, setCreateParentId] = useState<
    string | null | undefined
  >(undefined)
  const [renameTarget, setRenameTarget] = useState<FolderTreeNode | null>(null)
  const [moveFolderTarget, setMoveFolderTarget] =
    useState<FolderTreeNode | null>(null)
  const [moveFileIds, setMoveFileIds] = useState<string[] | null>(null)
  const [editTagsFile, setEditTagsFile] = useState<FileType | null>(null)
  const [manageTagsOpen, setManageTagsOpen] = useState(false)
  const [deleteFolderTarget, setDeleteFolderTarget] =
    useState<FolderTreeNode | null>(null)

  const isFolderView = filters.viewMode === 'folder' && organizationEnabled
  const currentFolderId =
    isFolderView && filters.folderId && filters.folderId !== 'none'
      ? filters.folderId
      : null

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
          setFileTypes([])
          return
        }
        const data = await response.json()
        setFileTypes(Array.isArray(data.data.types) ? data.data.types : [])
      } catch {
        setFileTypes([])
      }
    }
    fetchFileTypes()
  }, [])

  const typesKey = filters.types.join(',')
  const tagsKey = filters.tags.join(',')
  const visibilityKey = filters.visibility.join(',')

  const fetchFiles = useCallback(async () => {
    try {
      setIsLoading(true)

      // In folder view, the file list shows the current folder's direct files
      // (unfiled at the root). Elsewhere the folder filter is applied verbatim.
      const folderParam = isFolderView
        ? (currentFolderId ?? 'none')
        : filters.folderId || ''

      const params = new URLSearchParams({
        page: filters.page.toString(),
        limit: filters.limit.toString(),
        search: filters.search,
        sortBy: filters.sortBy,
        ...(typesKey && { types: typesKey }),
        ...(filters.dateFrom && { dateFrom: filters.dateFrom }),
        ...(filters.dateTo && { dateTo: filters.dateTo }),
        ...(visibilityKey && { visibility: visibilityKey }),
        ...(folderParam && { folderId: folderParam }),
        ...(tagsKey && { tags: tagsKey }),
      })
      const response = await fetch(`/api/files?${params}`)
      if (!response.ok) throw new Error('Failed to fetch files')
      const apiResult = await response.json()
      setFiles(Array.isArray(apiResult.data) ? apiResult.data : [])
      setPaginationInfo({
        total: apiResult.pagination?.total || 0,
        pageCount: apiResult.pagination?.pageCount || 0,
        page: filters.page,
        limit: filters.limit,
      })
    } catch (error) {
      console.error('Error fetching files:', error)
    } finally {
      setIsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filters.page,
    filters.limit,
    filters.search,
    filters.sortBy,
    filters.dateFrom,
    filters.dateTo,
    filters.folderId,
    filters.viewMode,
    typesKey,
    tagsKey,
    visibilityKey,
    isFolderView,
    currentFolderId,
  ])

  useEffect(() => {
    fetchFiles()
  }, [fetchFiles])

  const refreshAfterMutation = useCallback(async () => {
    await fetchFiles()
    if (organizationEnabled) {
      await Promise.all([refetchFolders(), refetchTags()])
    }
  }, [fetchFiles, organizationEnabled, refetchFolders, refetchTags])

  const handleDelete = useCallback(
    (fileId: string) => {
      setFiles((prev) => prev.filter((file) => file.id !== fileId))
      setPaginationInfo((prev) => ({
        ...prev,
        total: Math.max(0, prev.total - 1),
        pageCount: Math.ceil(Math.max(0, prev.total - 1) / prev.limit),
      }))
      selection.deselect(fileId)
    },
    [selection]
  )

  const handleSelectAll = useCallback(
    (selected: boolean) => {
      if (selected) {
        selection.selectMany(files.map((f) => f.id))
      } else {
        selection.clear()
      }
    },
    [files, selection]
  )

  // Bulk actions.
  const bulkAction = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await fetch('/api/files/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        toast({ title: 'Action failed', variant: 'destructive' })
        return false
      }
      return true
    },
    [toast]
  )

  const handleBulkAddTags = useCallback(
    async (tagIds: string[]) => {
      const ok = await bulkAction({
        fileIds: selection.selectedArray,
        action: 'addTags',
        tagIds,
      })
      if (ok) {
        toast({ title: 'Tags added' })
        await refreshAfterMutation()
      }
    },
    [bulkAction, refreshAfterMutation, selection.selectedArray, toast]
  )

  const handleBulkDownload = useCallback(() => {
    for (const id of selection.selectedArray) {
      const a = document.createElement('a')
      a.href = `/api/files/${id}/download`
      a.download = ''
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }
  }, [selection.selectedArray])

  const handleBulkDelete = useCallback(async () => {
    const ok = await bulkAction({
      fileIds: selection.selectedArray,
      action: 'delete',
    })
    if (ok) {
      toast({ title: 'Files deleted' })
      selection.clear()
      await refreshAfterMutation()
    }
  }, [bulkAction, refreshAfterMutation, selection, toast])
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

  // Folder card children for folder view.
  const folderChildren: FolderTreeNode[] = useMemo(() => {
    if (!isFolderView) return []
    if (!currentFolderId) return tree
    return findNode(tree, currentFolderId)?.children ?? []
  }, [isFolderView, currentFolderId, tree])

  const breadcrumb = useMemo(
    () =>
      currentFolderId
        ? getBreadcrumb(
            folders.map((f) => ({
              id: f.id,
              name: f.name,
              parentId: f.parentId,
            })),
            currentFolderId
          )
        : [],
    [folders, currentFolderId]
  )

  // Disabled destinations when moving a folder (itself + descendants).
  const moveFolderDisabledIds = useMemo(() => {
    if (!moveFolderTarget) return new Set<string>()
    const ids = getDescendantIds(
      folders.map((f) => ({ id: f.id, parentId: f.parentId })),
      moveFolderTarget.id
    )
    return new Set<string>([moveFolderTarget.id, ...ids])
  }, [moveFolderTarget, folders])

  const dateRangeValue =
    filters.dateFrom || filters.dateTo
      ? {
          from: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
          to: filters.dateTo ? new Date(filters.dateTo) : undefined,
        }
      : undefined

  const hasActiveFilters = Boolean(
    filters.search ||
      filters.types.length > 0 ||
      filters.visibility.length > 0 ||
      filters.dateFrom ||
      filters.dateTo ||
      filters.tags.length > 0 ||
      (filters.folderId && !isFolderView)
  )

  const handleMoveConfirm = useCallback(
    async (folderId: string | null) => {
      if (!moveFileIds) return
      const ok = await bulkAction({
        fileIds: moveFileIds,
        action: 'move',
        folderId,
      })
      if (ok) {
        toast({ title: 'Moved' })
        selection.clear()
        await refreshAfterMutation()
      }
      setMoveFileIds(null)
    },
    [moveFileIds, bulkAction, toast, selection, refreshAfterMutation]
  )

  const handleEditTagsSave = useCallback(
    async (tagIds: string[]) => {
      if (!editTagsFile) return
      const response = await fetch(`/api/files/${editTagsFile.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagIds }),
      })
      if (!response.ok) {
        toast({ title: 'Failed to update tags', variant: 'destructive' })
        return false
      }
      toast({ title: 'Tags updated' })
      await refreshAfterMutation()
    },
    [editTagsFile, toast, refreshAfterMutation]
  )

  const renderFileGrid = () => (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {files.map((file) => (
        <FileCard
          key={file.id}
          file={file}
          onDelete={handleDelete}
          organizationEnabled={organizationEnabled}
          selectable={organizationEnabled}
          selected={selection.isSelected(file.id)}
          onSelectChange={(id, sel) =>
            sel ? selection.select(id) : selection.deselect(id)
          }
          onRequestMove={(f) => setMoveFileIds([f.id])}
          onRequestEditTags={(f) => setEditTagsFile(f)}
          onTagClick={(tagId) =>
            setTags(
              filters.tags.includes(tagId)
                ? filters.tags
                : [...filters.tags, tagId]
            )
          }
        />
      ))}
    </div>
  )

  const renderFileList = () => (
    <FileListView
      files={files}
      organizationEnabled={organizationEnabled}
      selectedIds={selection.selectedIds}
      onSelectChange={(id, sel) =>
        sel ? selection.select(id) : selection.deselect(id)
      }
      onSelectAll={handleSelectAll}
      onRequestMove={(f) => setMoveFileIds([f.id])}
      onRequestEditTags={(f) => setEditTagsFile(f)}
      onTagClick={(tagId) =>
        setTags(
          filters.tags.includes(tagId)
            ? filters.tags
            : [...filters.tags, tagId]
        )
      }
      onDelete={handleDelete}
    />
  )

  const renderEmpty = () => (
    <EmptyPlaceholder>
      <EmptyPlaceholder.Icon name="file" />
      {hasActiveFilters ? (
        <>
          <EmptyPlaceholder.Title>No files found</EmptyPlaceholder.Title>
          <EmptyPlaceholder.Description>
            Try adjusting your filters to find files.
          </EmptyPlaceholder.Description>
        </>
      ) : isFolderView && currentFolderId ? (
        <>
          <EmptyPlaceholder.Title>This folder is empty</EmptyPlaceholder.Title>
          <EmptyPlaceholder.Description>
            Upload files here or move existing files into this folder.
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

  const renderContent = () => {
    if (isLoading) {
      return (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 12 }, (_, i) => (
              <FileCardSkeleton key={`skeleton-${i}`} />
            ))}
          </div>
          <PaginationSkeleton />
        </>
      )
    }

    const showFolderCards = isFolderView && folderChildren.length > 0
    const noFiles = files.length === 0 && paginationInfo.total === 0

    if (noFiles && !showFolderCards) {
      return renderEmpty()
    }

    return (
      <>
        {showFolderCards && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mb-6">
            {folderChildren.map((node) => (
              <FolderCard
                key={node.id}
                folder={node}
                onOpen={(id) => setFolderId(id)}
                onRename={(f) => setRenameTarget(f)}
                onMove={(f) => setMoveFolderTarget(f)}
                onDelete={(f) => setDeleteFolderTarget(f)}
              />
            ))}
          </div>
        )}
        {filters.viewMode === 'list' ? renderFileList() : renderFileGrid()}
        <FileGridPagination paginationInfo={paginationInfo} setPage={setPage} />
      </>
    )
  }

  return (
    <div className="space-y-6">
      <div className="relative rounded-2xl bg-white/10 dark:bg-black/10 backdrop-blur-xl border border-white/20 dark:border-white/10 shadow-lg shadow-black/5 dark:shadow-black/20">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/10 via-transparent to-black/5 dark:from-white/5 dark:via-transparent dark:to-black/10" />
        <div className="relative">
          <div className="p-6 pb-4 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">Your Files</h1>
              <p className="text-muted-foreground mt-1">
                View and manage your uploaded files
              </p>
            </div>
            <ViewSwitcher
              value={filters.viewMode}
              onChange={setViewMode}
              allowFolder={organizationEnabled}
            />
          </div>

          <div className="px-6 pb-6">
            <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
              <SearchInput onSearch={setSearch} initialValue={filters.search} />
              <div className="flex gap-2 flex-wrap">
                {organizationEnabled && !isFolderView && (
                  <FolderFilter
                    tree={tree}
                    value={filters.folderId}
                    onChange={setFolderId}
                  />
                )}
                {organizationEnabled && (
                  <TagFilter
                    tags={tags}
                    selectedIds={filters.tags}
                    onChange={setTags}
                    onManage={() => setManageTagsOpen(true)}
                  />
                )}
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
      </div>

      {isFolderView ? (
        <div className="flex flex-col lg:flex-row gap-6">
          <aside className="lg:w-64 shrink-0">
            <div className="rounded-2xl bg-background/40 backdrop-blur-xl border border-border/50 p-3 lg:sticky lg:top-24">
              <FolderSidebar
                tree={tree}
                totalFileCount={0}
                selectedFolderId={filters.folderId}
                onSelect={setFolderId}
                onCreateRoot={() => setCreateParentId(null)}
                onCreateChild={(parentId) => setCreateParentId(parentId)}
                onRename={(node) => setRenameTarget(node)}
                onMove={(node) => setMoveFolderTarget(node)}
                onDelete={(node) => setDeleteFolderTarget(node)}
              />
            </div>
          </aside>
          <div className="flex-1 min-w-0 space-y-4">
            {currentFolderId && (
              <FolderBreadcrumb items={breadcrumb} onNavigate={setFolderId} />
            )}
            {renderContent()}
          </div>
        </div>
      ) : (
        renderContent()
      )}

      {organizationEnabled && (
        <BulkActionsBar
          count={selection.count}
          tags={tags}
          onClear={selection.clear}
          onMove={() => setMoveFileIds(selection.selectedArray)}
          onAddTags={handleBulkAddTags}
          onCreateTag={(name) => createTag({ name })}
          onDownload={handleBulkDownload}
          onDelete={() => setBulkDeleteOpen(true)}
        />
      )}

      {/* Folder create/rename dialog */}
      <FolderDialog
        open={createParentId !== undefined}
        onOpenChange={(open) => !open && setCreateParentId(undefined)}
        mode="create"
        onSubmit={async ({ name, color }) => {
          const created = await createFolder({
            name,
            parentId: createParentId ?? null,
            color,
          })
          return created !== null
        }}
      />
      <FolderDialog
        open={renameTarget !== null}
        onOpenChange={(open) => !open && setRenameTarget(null)}
        mode="rename"
        initialName={renameTarget?.name}
        initialColor={renameTarget?.color}
        onSubmit={async ({ name, color }) => {
          if (!renameTarget) return false
          return updateFolder(renameTarget.id, { name, color })
        }}
      />

      {/* Move a folder */}
      <MoveToFolderDialog
        open={moveFolderTarget !== null}
        onOpenChange={(open) => !open && setMoveFolderTarget(null)}
        tree={tree}
        disabledIds={moveFolderDisabledIds}
        title={`Move "${moveFolderTarget?.name ?? ''}"`}
        onSelect={async (folderId) => {
          if (!moveFolderTarget) return false
          return updateFolder(moveFolderTarget.id, { parentId: folderId })
        }}
      />

      {/* Move file(s) */}
      <MoveToFolderDialog
        open={moveFileIds !== null}
        onOpenChange={(open) => !open && setMoveFileIds(null)}
        tree={tree}
        title={
          moveFileIds && moveFileIds.length > 1
            ? `Move ${moveFileIds.length} files`
            : 'Move file'
        }
        onSelect={handleMoveConfirm}
      />

      {/* Edit a single file's tags */}
      {editTagsFile && (
        <EditTagsDialog
          open={editTagsFile !== null}
          onOpenChange={(open) => !open && setEditTagsFile(null)}
          fileName={editTagsFile.name}
          allTags={tags}
          initialTagIds={editTagsFile.tags.map((t) => t.id)}
          onCreateTag={(name) => createTag({ name })}
          onSave={handleEditTagsSave}
        />
      )}

      {/* Manage tags */}
      <ManageTagsDialog
        open={manageTagsOpen}
        onOpenChange={setManageTagsOpen}
        tags={tags}
        onCreate={(input) => createTag(input)}
        onUpdate={(id, input) => updateTag(id, input)}
        onDelete={async (id) => {
          const ok = await deleteTag(id)
          if (ok) {
            setTags(filters.tags.filter((t) => t !== id))
            await fetchFiles()
          }
          return ok
        }}
      />

      {/* Delete folder confirmation */}
      <AlertDialog
        open={deleteFolderTarget !== null}
        onOpenChange={(open) => !open && setDeleteFolderTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete &ldquo;{deleteFolderTarget?.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The files inside this folder will be kept and moved up one level.
              Any subfolders will also move up. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!deleteFolderTarget) return
                const ok = await deleteFolder(deleteFolderTarget.id)
                if (ok) {
                  if (filters.folderId === deleteFolderTarget.id) {
                    setFolderId(null)
                  }
                  await fetchFiles()
                }
                setDeleteFolderTarget(null)
              }}
            >
              Delete folder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete confirmation */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selection.count} file{selection.count === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              These files will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setBulkDeleteOpen(false)
                await handleBulkDelete()
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
