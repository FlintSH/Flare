'use client'

import { type MouseEvent, useState } from 'react'

import Image from 'next/image'
import Link from 'next/link'

import { FileType } from '@/types/components/file'
import { format, formatDistanceToNow } from 'date-fns'
import {
  Clock,
  Download,
  Eye,
  Folder,
  Globe,
  KeyRound,
  Lock,
  MoreHorizontal,
  Tag,
  Timer,
} from 'lucide-react'

import { FileActionMenuItems } from '@/components/file/actions/file-action-menu'
import { useFileActions } from '@/components/file/actions/use-file-actions'
import { FileTypeIcon } from '@/components/file/file-type-icon'
import { VideoBadge } from '@/components/file/video-badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { openFileSheet } from '@/lib/client/file-sheet'
import { fileKind, fileTypeLabel, hasThumbnail } from '@/lib/files/file-kind'
import { thumbnailLoader } from '@/lib/files/urls'
import type { FolderView } from '@/lib/folders/schema'
import { cn, formatFileSize, getRelativeTime } from '@/lib/utils'

// Folder and tag labels share one fixed-height line with the activity counts,
// so every card in the grid keeps the same height. Each name is capped so a
// long label cannot crowd out a short one in narrow cards, and counts from
// 1,000 are abbreviated (1.4K) so large numbers leave room for the labels.
const labelClassName =
  'inline-flex h-5 min-w-0 items-center gap-1 overflow-hidden rounded-md border border-border/60 bg-muted/70 px-1.5 text-[11px] leading-4 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none'
const compactCount = new Intl.NumberFormat(undefined, { notation: 'compact' })

interface FileCardProps {
  file: FileType
  onDelete?: (id: string) => void
  onBrowseArchive?: () => void
  onEditTags?: () => void
  onTagSelect?: (id: string) => void
  folder?: FolderView
  onFolderSelect?: (id: string) => void
  selected?: boolean
  onSelect?: () => void
}

/**
 * One file in the library. It shows the file it is given; each action ends
 * by asking the library to reload, which brings the changed file.
 */
export function FileCard({
  file,
  onDelete,
  onBrowseArchive,
  onEditTags,
  onTagSelect,
  folder,
  onFolderSelect,
  selected,
  onSelect,
}: FileCardProps) {
  const [previewFailed, setPreviewFailed] = useState(false)
  // A file opens its sheet in the app; a modified click still opens its
  // share page in a new tab, as a link does.
  const openSheet = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    openFileSheet(file.id)
  }
  const {
    urls,
    editTags,
    offered,
    permitted,
    menuLabel,
    preloadDialogs,
    dialogs: fileDialogs,
  } = useFileActions(file, {
    onDelete,
    onBrowseArchive,
    onEditTags,
  })
  const isVideo = fileKind(file).kind === 'video'
  const visibilityLabel = file.visibility === 'PUBLIC' ? 'Public' : 'Private'
  const VisibilityIcon = file.visibility === 'PUBLIC' ? Globe : Lock
  const tags = file.tags ?? []
  const visibleTags = tags.slice(0, folder ? 1 : 2)
  return (
    <Card
      onPointerEnter={preloadDialogs}
      onFocus={preloadDialogs}
      className={cn(
        'group relative min-w-0 overflow-hidden rounded-xl border-border/60 bg-panel shadow-sm transition-colors',
        // Selected cards keep a 2px edge inside the column: the border plus a
        // ring drawn above the thumbnail and the hover veil, so it looks the
        // same on every card and while hovered. The ring sits inside the
        // border, so its corners use the border's inner radius.
        selected
          ? 'border-primary after:pointer-events-none after:absolute after:inset-0 after:z-20 after:rounded-[calc(0.75rem-1px)] after:ring-1 after:ring-inset after:ring-primary'
          : 'hover:border-primary/30'
      )}
    >
      <div className="relative">
        <Link
          prefetch={false}
          href={urls.page}
          aria-label={`Open ${file.name}`}
          aria-haspopup="dialog"
          data-sheet-opener={file.id}
          onClick={openSheet}
          className="relative block aspect-[4/3] overflow-hidden bg-muted/50 after:pointer-events-none after:absolute after:inset-0 after:z-10 after:hidden after:ring-2 after:ring-inset after:ring-ring focus-visible:outline-none focus-visible:after:block"
        >
          {hasThumbnail(file) && !previewFailed ? (
            <>
              <Image
                loader={thumbnailLoader}
                src={urls.thumbnail}
                alt={file.name}
                fill
                className="object-cover"
                sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                loading="lazy"
                onError={() => setPreviewFailed(true)}
              />
              {/* Steps aside for the hover and focus controls, as the
                  icon of a file without a picture does. */}
              {isVideo && <VideoBadge />}
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <FileTypeIcon
                file={file}
                className="h-12 w-12 text-muted-foreground"
              />
              <span className="rounded-md border border-border bg-background/60 px-2 py-1 text-xs font-medium text-muted-foreground max-sm:hidden">
                {file.name.includes('.')
                  ? file.name.split('.').pop()?.toUpperCase().slice(0, 12)
                  : fileTypeLabel(file.mimeType)}
              </span>
            </div>
          )}
        </Link>
        {onSelect && (
          <label className="absolute left-2 top-2 z-10 flex cursor-pointer items-center rounded-lg border border-border/50 bg-background/95 p-2 shadow-sm">
            <input
              type="checkbox"
              checked={!!selected}
              onChange={onSelect}
              aria-label={`Select ${file.name}`}
              className="h-4 w-4 cursor-pointer accent-primary"
            />
          </label>
        )}
        <div className="absolute right-2 top-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-lg border border-border/50 bg-background/90 shadow-sm hover:bg-background data-[state=open]:bg-accent"
                aria-label={`Manage ${file.name}`}
                title="Manage file"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Manage file</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <FileActionMenuItems offered={offered} label={menuLabel} />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="pointer-events-none absolute bottom-2 inset-x-2 flex items-end justify-between gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-md border border-border/40 bg-background/90 px-2 py-1 backdrop-blur-sm">
            {file.hasPassword ? (
              <KeyRound className="h-3 w-3" />
            ) : (
              <VisibilityIcon className="h-3 w-3" />
            )}
            {file.hasPassword ? 'Protected' : visibilityLabel}
          </span>
          <span
            className="hidden items-center gap-1 rounded-md border border-border/40 bg-background/90 px-2 py-1 backdrop-blur-sm sm:inline-flex"
            title={format(new Date(file.uploadedAt), 'PPP p')}
          >
            <Clock className="h-3 w-3" />
            {getRelativeTime(new Date(file.uploadedAt))}
          </span>
        </div>
        {file.expiresAt && !onSelect && permitted('expiration') && (
          <button
            type="button"
            onClick={() => openFileSheet(file.id)}
            title={`Expiration scheduled for ${format(new Date(file.expiresAt), 'PPP p')}`}
            className="absolute left-2 top-2 inline-flex h-8 max-w-[calc(100%-3.5rem)] items-center gap-1 rounded-md border border-border/50 bg-background/90 px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Timer className="h-3 w-3 shrink-0 text-primary" />
            <span className="truncate">
              {formatDistanceToNow(new Date(file.expiresAt), {
                addSuffix: true,
              })}
            </span>
          </button>
        )}
      </div>
      <div className="border-t border-border/40 p-2.5 sm:p-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-0.5 sm:flex-nowrap">
          <Link
            prefetch={false}
            href={urls.page}
            title={file.name}
            aria-haspopup="dialog"
            onClick={openSheet}
            className="min-w-0 max-w-full basis-full truncate rounded-sm text-sm font-medium sm:basis-auto hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {file.name}
          </Link>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatFileSize(file.size)}
          </span>
        </div>
        <div className="mt-1 flex h-5 items-center gap-3 text-xs text-muted-foreground">
          <div className="flex min-w-0 items-center gap-1.5">
            {folder && (
              <button
                type="button"
                onClick={() => onFolderSelect?.(folder.id)}
                disabled={!onFolderSelect}
                title={folder.name}
                aria-label={`Open folder ${folder.name}`}
                className={labelClassName}
              >
                <Folder className="h-2.5 w-2.5 shrink-0" />
                <span className="max-w-20 truncate">{folder.name}</span>
              </button>
            )}
            {visibleTags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => onTagSelect?.(tag.id)}
                disabled={!onTagSelect}
                title={tag.name}
                aria-label={`Show files tagged ${tag.name}`}
                className={labelClassName}
              >
                <Tag className="h-2.5 w-2.5 shrink-0" />
                <span className="max-w-20 truncate">{tag.name}</span>
              </button>
            ))}
            {tags.length > visibleTags.length &&
              (editTags ? (
                <button
                  type="button"
                  onClick={editTags.run}
                  aria-label={`View all ${tags.length} tags`}
                  className="shrink-0 rounded px-1 text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  +{tags.length - visibleTags.length}
                </button>
              ) : (
                <span
                  title={`${tags.length} tags`}
                  className="shrink-0 px-1 text-[11px] text-muted-foreground"
                >
                  +{tags.length - visibleTags.length}
                </span>
              ))}
          </div>
          <div className="ml-auto hidden shrink-0 items-center gap-3 sm:flex">
            <span
              className="inline-flex items-center gap-1"
              aria-label={`${file.views} views`}
              title={`${file.views.toLocaleString()} views`}
            >
              <Eye className="h-3 w-3" />
              {compactCount.format(file.views)}
            </span>
            <span
              className="inline-flex items-center gap-1"
              aria-label={`${file.downloads} downloads`}
              title={`${file.downloads.toLocaleString()} downloads`}
            >
              <Download className="h-3 w-3" />
              {compactCount.format(file.downloads)}
            </span>
          </div>
        </div>
      </div>

      {fileDialogs}
    </Card>
  )
}
