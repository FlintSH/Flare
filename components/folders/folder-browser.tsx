'use client'

import { useEffect, useId, useState } from 'react'

import Link from 'next/link'

import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  Link2,
  MoreHorizontal,
  Pencil,
  Share2,
  Trash2,
  Upload,
} from 'lucide-react'

import {
  type FolderAction,
  FolderDialog,
} from '@/components/folders/folder-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { folderTrail } from '@/lib/folders/navigation'
import type { FolderView } from '@/lib/folders/schema'
import { UNFILED, uploadHref } from '@/lib/library/contract'
import { allows } from '@/lib/permissions/actions'
import { cn } from '@/lib/utils'

import { usePermissions } from '@/hooks/use-permissions'

const folderNavigationButtonClassName =
  'h-11 max-w-full shrink-0 flex-wrap gap-1 whitespace-normal px-2 text-xs max-sm:h-auto max-sm:!min-h-[44px] max-sm:!min-w-[44px] max-sm:gap-[4px] max-sm:px-[8px] max-sm:py-[6px] sm:h-8 sm:gap-1.5 sm:px-3 sm:text-sm'

export function FolderBrowser({
  folders,
  value,
  onChange,
  loading,
  error,
  onRetry,
}: {
  folders: FolderView[]
  value: string | null
  onChange: (id: string | null) => void
  loading: boolean
  error: boolean
  onRetry: () => void
}) {
  const { user } = usePermissions()
  const canManage = allows(user, 'manageFolders')
  const canShare = allows(user, 'shareFolders')
  const [action, setAction] = useState<FolderAction | null>(null)
  const [expanded, setExpanded] = useState(false)
  const expansionKey = `flare:folders:${user?.id ?? 'anonymous'}:${value ?? 'all'}`
  useEffect(() => {
    try {
      setExpanded(localStorage.getItem(expansionKey) === 'open')
    } catch {
      setExpanded(false)
    }
  }, [expansionKey])
  const toggleExpanded = () => {
    const next = !expanded
    setExpanded(next)
    try {
      localStorage.setItem(expansionKey, next ? 'open' : 'closed')
    } catch {
      /* Storage can be disabled. The control still works. */
    }
  }

  const foldersId = useId()
  const current = folders.find((folder) => folder.id === value)
  const trail = folderTrail(folders, current?.id ?? null)
  const children = folders
    .filter((folder) => folder.parentId === (current?.id ?? null))
    .sort((a, b) => a.name.localeCompare(b.name))
  const menu = (folder: FolderView) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0 data-[state=open]:bg-accent sm:h-8 sm:w-8"
          aria-label={`Manage folder ${folder.name}`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      {/* Titled and sized like the file card's menu. */}
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Manage folder</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {canManage && (
          <DropdownMenuItem
            onSelect={() => setAction({ kind: 'rename', folder })}
          >
            <Pencil />
            Rename folder
          </DropdownMenuItem>
        )}
        {canShare && (
          <DropdownMenuItem
            onSelect={() => setAction({ kind: 'share', folder })}
          >
            <Share2 />
            Share folder
          </DropdownMenuItem>
        )}
        {canManage && (
          <DropdownMenuItem
            onSelect={() => setAction({ kind: 'create', parentId: folder.id })}
          >
            <FolderPlus />
            New subfolder
          </DropdownMenuItem>
        )}
        {canManage && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:bg-danger/10 focus:text-destructive"
              onSelect={() => setAction({ kind: 'delete', folder })}
            >
              <Trash2 />
              Remove folder
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
  return (
    <div
      className={cn(
        'mt-[4px] border-t border-border/50 pt-[4px] sm:mt-4 sm:pt-4',
        !folders.length && !value && !canManage && !error && 'hidden sm:block'
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2 sm:gap-3">
        {folders.length || value ? (
          <nav
            aria-label="File library"
            className="flex min-w-0 max-w-full flex-wrap items-center gap-1"
          >
            <Button
              variant={value === null ? 'secondary' : 'ghost'}
              size="sm"
              className={cn(
                folderNavigationButtonClassName,
                value !== null && 'text-muted-foreground'
              )}
              aria-current={value === null ? 'page' : undefined}
              onClick={() => onChange(null)}
            >
              All files
            </Button>
            <Button
              variant={value === UNFILED ? 'secondary' : 'ghost'}
              size="sm"
              className={cn(
                folderNavigationButtonClassName,
                value !== UNFILED && 'text-muted-foreground'
              )}
              aria-current={value === UNFILED ? 'page' : undefined}
              onClick={() => onChange(UNFILED)}
            >
              Unfiled
            </Button>
            {value !== UNFILED && children.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={expanded}
                aria-controls={foldersId}
                onClick={toggleExpanded}
                className={cn(
                  folderNavigationButtonClassName,
                  'text-muted-foreground'
                )}
              >
                <Folder
                  className="hidden h-4 w-4 sm:block"
                  aria-hidden="true"
                />
                {current ? 'Subfolders' : 'Folders'}
                <span className="tabular-nums">{children.length}</span>
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    'h-3.5 w-3.5 transition-transform motion-reduce:transition-none',
                    expanded && 'rotate-180'
                  )}
                />
              </Button>
            )}
          </nav>
        ) : (
          <p className="hidden text-sm text-muted-foreground sm:block">
            A place for everything, when you need it.
          </p>
        )}
        <div
          className={cn(
            'flex min-w-0 max-w-full flex-wrap items-center gap-1',
            !current &&
              value !== UNFILED &&
              children.length > 0 &&
              'hidden sm:flex'
          )}
        >
          {current && canShare && (
            <Button
              variant="ghost"
              size="sm"
              className={cn(folderNavigationButtonClassName, 'text-sm')}
              onClick={() => setAction({ kind: 'share', folder: current })}
            >
              <Share2 className="h-4 w-4" />
              Share
            </Button>
          )}
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              className={cn(
                folderNavigationButtonClassName,
                'text-sm',
                value !== UNFILED &&
                  children.length > 0 &&
                  'hidden sm:inline-flex'
              )}
              title="New folder"
              disabled={
                loading || error || (!!value && value !== UNFILED && !current)
              }
              onClick={() =>
                setAction({ kind: 'create', parentId: current?.id ?? null })
              }
            >
              <FolderPlus className="h-4 w-4" aria-hidden="true" />
              New folder
            </Button>
          )}
          {current && (canManage || canShare) && menu(current)}
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          Couldn’t load folders.{' '}
          <button
            data-flare-control
            type="button"
            className="underline"
            onClick={onRetry}
          >
            Try again
          </button>
        </p>
      ) : loading && value ? (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          Loading folders…
        </p>
      ) : value && value !== UNFILED && !current ? (
        <p role="alert" className="mt-3 text-sm text-muted-foreground">
          This folder is no longer available.{' '}
          <button
            data-flare-control
            type="button"
            className="underline"
            onClick={() => onChange(null)}
          >
            Go to all files
          </button>
        </p>
      ) : (
        <>
          {/* Narrow trails wrap whole separator/name groups. Wider layouts
              keep a single line and truncate long names. */}
          {current && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3 sm:mt-4 sm:flex-nowrap">
              <nav
                aria-label="Folder breadcrumbs"
                className="min-w-0 max-w-full flex-1 basis-[min(100%,12rem)] sm:basis-0"
              >
                <ol className="flex min-w-0 max-w-full flex-wrap items-center gap-1 text-sm text-muted-foreground sm:-ml-1 sm:flex-nowrap">
                  <li className="shrink-0">
                    <button
                      data-flare-control
                      type="button"
                      onClick={() => onChange(null)}
                      className="rounded px-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background max-sm:!min-h-[44px] max-sm:!min-w-[44px] max-sm:px-[4px] max-sm:py-[6px]"
                    >
                      Folders
                    </button>
                  </li>
                  {trail.map((folder, index) => (
                    <li
                      key={folder.id}
                      className="flex min-w-0 max-w-full shrink items-center gap-1"
                    >
                      <ChevronRight
                        aria-hidden="true"
                        className="h-3.5 w-3.5 shrink-0"
                      />
                      <button
                        data-flare-control
                        type="button"
                        onClick={() => onChange(folder.id)}
                        aria-current={
                          index === trail.length - 1 ? 'page' : undefined
                        }
                        title={folder.name}
                        className={cn(
                          'min-w-0 max-w-full flex-1 whitespace-normal rounded px-1 [overflow-wrap:anywhere] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background max-sm:!min-h-[44px] max-sm:!min-w-[44px] max-sm:px-[4px] max-sm:py-[6px] sm:max-w-56 sm:flex-none sm:truncate',
                          index === trail.length - 1 &&
                            'font-medium text-foreground'
                        )}
                      >
                        {folder.name}
                      </button>
                    </li>
                  ))}
                </ol>
              </nav>
              {allows(user, ['uploadFiles', 'fileIntoFolder']) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="-mr-3 shrink-0 gap-2 max-sm:ml-auto max-sm:mr-0 max-sm:h-auto max-sm:!min-h-[44px] max-sm:max-w-full max-sm:flex-wrap max-sm:gap-[4px] max-sm:whitespace-normal max-sm:px-[8px] max-sm:py-[6px]"
                  asChild
                >
                  <Link href={uploadHref(current.id)}>
                    <Upload className="h-4 w-4" />
                    Upload here
                  </Link>
                </Button>
              )}
            </div>
          )}
          {value !== UNFILED && children.length > 0 && (
            <section
              id={foldersId}
              aria-label={current ? 'Subfolders' : 'Folders'}
              hidden={!expanded}
              className={cn(
                'mt-3 max-h-64 gap-2 overflow-y-auto rounded-lg p-1 -m-1 sm:grid-cols-2 lg:grid-cols-3',
                expanded && 'grid'
              )}
            >
              {canManage && (
                <div className="col-span-full pb-1 sm:hidden">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loading || error}
                    onClick={() =>
                      setAction({
                        kind: 'create',
                        parentId: current?.id ?? null,
                      })
                    }
                  >
                    <FolderPlus className="h-4 w-4" aria-hidden="true" />
                    New folder
                  </Button>
                </div>
              )}
              {children.map((folder) => (
                <div
                  key={folder.id}
                  className="flex min-w-0 items-center rounded-xl border border-border/60 bg-background/50 p-1 transition-colors hover:bg-muted/50"
                >
                  <button
                    data-flare-control
                    type="button"
                    onClick={() => onChange(folder.id)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Open folder ${folder.name}`}
                  >
                    <span className="rounded-lg bg-primary/10 p-1.5 text-primary">
                      <Folder className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate text-sm font-medium"
                        title={folder.name}
                      >
                        {folder.name}
                      </span>
                      <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        {folder.fileCount}{' '}
                        {folder.fileCount === 1 ? 'file' : 'files'}
                        {folders.some(
                          (child) => child.parentId === folder.id
                        ) && ' · Subfolders'}
                        {folder.shareToken && (
                          <Link2
                            className="h-3 w-3"
                            aria-label="Link sharing enabled"
                          />
                        )}
                      </span>
                    </span>
                  </button>
                  {(canManage || canShare) && menu(folder)}
                </div>
              ))}
            </section>
          )}
        </>
      )}
      {action && (
        <FolderDialog
          action={action}
          onClose={() => setAction(null)}
          onCreated={(folder) => onChange(folder.id)}
          onDeleted={(folder) => {
            if (value === folder.id) onChange(folder.parentId)
          }}
        />
      )}
    </div>
  )
}
