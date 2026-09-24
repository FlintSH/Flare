'use client'

import { useState } from 'react'

import Link from 'next/link'

import {
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { folderTrail } from '@/lib/folders/navigation'
import type { FolderView } from '@/lib/folders/schema'
import { cn } from '@/lib/utils'

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
  const [action, setAction] = useState<FolderAction | null>(null)
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
          className="h-8 w-8 shrink-0"
          aria-label={`Manage folder ${folder.name}`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => setAction({ kind: 'rename', folder })}
        >
          <Pencil />
          Rename folder
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setAction({ kind: 'share', folder })}>
          <Share2 />
          Share folder
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => setAction({ kind: 'create', parentId: folder.id })}
        >
          <FolderPlus />
          New subfolder
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => setAction({ kind: 'delete', folder })}
        >
          <Trash2 />
          Remove folder
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
  return (
    <div className="mt-4 border-t border-border/50 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {folders.length || value ? (
          <nav
            aria-label="File library"
            className="flex min-w-0 flex-wrap items-center gap-1"
          >
            <Button
              variant={value === null ? 'secondary' : 'ghost'}
              size="sm"
              aria-current={value === null ? 'page' : undefined}
              onClick={() => onChange(null)}
            >
              All files
            </Button>
            <Button
              variant={value === 'unfiled' ? 'secondary' : 'ghost'}
              size="sm"
              aria-current={value === 'unfiled' ? 'page' : undefined}
              onClick={() => onChange('unfiled')}
            >
              Unfiled
            </Button>
          </nav>
        ) : (
          <p className="text-sm text-muted-foreground">
            A place for everything, when you need it.
          </p>
        )}
        <div className="flex items-center gap-1">
          {current && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-2"
              onClick={() => setAction({ kind: 'share', folder: current })}
            >
              <Share2 className="h-4 w-4" />
              Share
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={
              loading || error || (!!value && value !== 'unfiled' && !current)
            }
            onClick={() =>
              setAction({ kind: 'create', parentId: current?.id ?? null })
            }
          >
            <FolderPlus className="h-4 w-4" />
            New folder
          </Button>
          {current && menu(current)}
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          Couldn’t load folders.{' '}
          <button type="button" className="underline" onClick={onRetry}>
            Try again
          </button>
        </p>
      ) : loading && value ? (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          Loading folders…
        </p>
      ) : value && value !== 'unfiled' && !current ? (
        <p role="alert" className="mt-3 text-sm text-muted-foreground">
          This folder is no longer available.{' '}
          <button
            type="button"
            className="underline"
            onClick={() => onChange(null)}
          >
            Go to all files
          </button>
        </p>
      ) : (
        <>
          {current && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <nav aria-label="Folder breadcrumbs" className="min-w-0 flex-1">
                <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
                  <li>
                    <button
                      type="button"
                      onClick={() => onChange(null)}
                      className="rounded px-1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Folders
                    </button>
                  </li>
                  {trail.map((folder, index) => (
                    <li
                      key={folder.id}
                      className="flex min-w-0 items-center gap-1"
                    >
                      <ChevronRight
                        aria-hidden="true"
                        className="h-3.5 w-3.5 shrink-0"
                      />
                      <button
                        type="button"
                        onClick={() => onChange(folder.id)}
                        aria-current={
                          index === trail.length - 1 ? 'page' : undefined
                        }
                        title={folder.name}
                        className={cn(
                          'max-w-56 truncate rounded px-1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
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
              <Button variant="ghost" size="sm" className="gap-2" asChild>
                <Link href={`/dashboard/upload?folder=${current.id}`}>
                  <Upload className="h-4 w-4" />
                  Upload here
                </Link>
              </Button>
            </div>
          )}
          {value !== 'unfiled' && children.length > 0 && (
            <section
              aria-label={current ? 'Subfolders' : 'Folders'}
              className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
            >
              {children.map((folder) => (
                <div
                  key={folder.id}
                  className="flex min-w-0 items-center rounded-xl border border-border/60 bg-background/50 p-2 transition-colors hover:bg-muted/50"
                >
                  <button
                    type="button"
                    onClick={() => onChange(folder.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Open folder ${folder.name}`}
                  >
                    <span className="rounded-lg bg-primary/10 p-2 text-primary">
                      <Folder className="h-5 w-5" />
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
                  {menu(folder)}
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
