'use client'

import { Fragment, type MouseEvent, useState } from 'react'

import Image from 'next/image'
import Link from 'next/link'

import { FileType } from '@/types/components/file'
import { ExpiryAction } from '@/types/events'
import { format, formatDistanceToNow } from 'date-fns'
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  Eye,
  Folder,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  MoreHorizontal,
  Tag,
  Timer,
} from 'lucide-react'

import {
  CARD_BUTTONS,
  CARD_MENU,
  FILE_ACTIONS,
  type FileActionId,
  fileActionAllowed,
} from '@/components/dashboard/file-card/actions'
import {
  type FileMenuSide,
  fileCardActivityClassName,
  fileCardDetailsClassName,
  fileCardFilenameParts,
  fileCardLabelsClassName,
  fileCardNameRowClassName,
  fileCardPreviewClassName,
  fileListClassName,
  fileListFactsClassName,
  fileListLabelsClassName,
  fileListManageClassName,
  fileListNameClassName,
  fileVisibilityText,
} from '@/components/dashboard/file-card/layout'
import { FileTypeIcon } from '@/components/file/file-type-icon'
import { ExpiryModal } from '@/components/shared/expiry-modal'
import { OcrDialog } from '@/components/shared/ocr-dialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

import { RefusedRequest, apiRequest } from '@/lib/client/request'
import { fileTypeLabel } from '@/lib/files/file-kind'
import { filePasswordHint } from '@/lib/files/password-policy'
import { canOptimizeThumbnail, fileUrls } from '@/lib/files/urls'
import type { FolderView } from '@/lib/folders/schema'
import type { LibraryView } from '@/lib/library/view'
import { cn, formatFileSize, getRelativeTime } from '@/lib/utils'
import { scrollFadeRef } from '@/lib/utils/scroll-fade'

import { useOcr } from '@/hooks/use-ocr'
import { usePermissions } from '@/hooks/use-permissions'
import { useRequestLifetime } from '@/hooks/use-request-lifetime'
import { useToast } from '@/hooks/use-toast'

// Labels wrap intrinsically as enlarged text outgrows a shared row.
const labelClassName =
  'inline-flex min-h-6 min-w-0 flex-1 basis-[6rem] items-center gap-1 rounded-md border border-border/60 bg-muted/70 px-1.5 text-xs leading-4 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none [@media(pointer:coarse)]:!min-h-[44px]'
const compactCount = new Intl.NumberFormat(undefined, { notation: 'compact' })
const previewActions = CARD_BUTTONS.filter(
  (id) => id === 'copyLink' || id === 'download'
)

const TRY_AGAIN = 'Please try again.'
const failure = (error: unknown) =>
  error instanceof RefusedRequest ? error.message : TRY_AGAIN

interface FileCardProps {
  view?: LibraryView
  menuSide?: FileMenuSide
  file: FileType
  onDelete?: (id: string) => void
  onUpdate?: () => void
  onPreview?: (file: FileType) => void
  onBrowseArchive?: () => void
  onEditTags?: () => void
  onTagSelect?: (id: string) => void
  onMove?: () => void
  folder?: FolderView
  onFolderSelect?: (id: string) => void
  selected?: boolean
  onSelect?: () => void
}

/**
 * One file in the library. It shows the file it is given; each action ends
 * by asking the library to reload, which brings the changed file.
 */
// A palette band on each side of the configured ring keeps focus readable
// against uploaded pixels, like the expanded image control.
const previewFocusClassName =
  'focus-visible:ring-0 focus-visible:shadow-[0_0_0_2px_hsl(var(--background)),0_0_0_4px_hsl(var(--ring)),0_0_0_6px_hsl(var(--foreground))]'

export function FileCard({
  view = 'gallery',
  menuSide = 'bottom',
  file,
  onDelete,
  onUpdate,
  onPreview,
  onBrowseArchive,
  onEditTags,
  onTagSelect,
  onMove,
  folder,
  onFolderSelect,
  selected,
  onSelect,
}: FileCardProps) {
  const isList = view === 'list'
  const { user } = usePermissions()
  const { toast } = useToast()
  const lifetime = useRequestLifetime()
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false)
  const [isVisibilityDialogOpen, setIsVisibilityDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [password, setPassword] = useState('')
  const passwordHint = password ? filePasswordHint(password) : null
  const [visibility, setVisibility] = useState<'PUBLIC' | 'PRIVATE'>(
    file.visibility
  )
  const [mutation, setMutation] = useState<
    'delete' | 'password' | 'visibility' | null
  >(null)
  const urls = fileUrls(file)
  const ocr = useOcr(urls.ocr)
  const [isExpiryModalOpen, setIsExpiryModalOpen] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)

  const handlePasswordDialogOpenChange = (open: boolean) => {
    if (mutation === 'password') return
    setPassword('')
    setIsPasswordDialogOpen(open)
  }

  const handleCopyLink = async () => {
    const { signal } = lifetime.current
    if (signal.aborted) return
    try {
      await navigator.clipboard.writeText(
        fileUrls(file, { origin: window.location.origin }).page
      )
      if (signal.aborted) return
      toast({
        title: 'Link copied',
        description: 'Your file is ready to share.',
      })
    } catch {
      if (signal.aborted) return
      toast({
        title: 'Couldn’t copy the link',
        description: 'Open the file and copy its address from your browser.',
        variant: 'destructive',
      })
    }
  }

  const handleDelete = async () => {
    const { signal } = lifetime.current
    if (mutation || signal.aborted) return
    setMutation('delete')
    try {
      await apiRequest(`/api/files/${file.id}`, {
        method: 'DELETE',
        signal,
        fallback: TRY_AGAIN,
      })
      if (signal.aborted) return
      setIsDeleteDialogOpen(false)
      onDelete?.(file.id)
      toast({
        title: 'File deleted',
        description: 'The file has been permanently deleted.',
      })
    } catch (error) {
      if (signal.aborted) return
      toast({
        title: 'Couldn’t delete this file',
        description: failure(error),
        variant: 'destructive',
      })
    } finally {
      if (!signal.aborted) setMutation(null)
    }
  }

  const handlePasswordUpdate = async () => {
    const { signal } = lifetime.current
    if (mutation || signal.aborted) return
    setMutation('password')
    try {
      await apiRequest(`/api/files/${file.id}`, {
        method: 'PATCH',
        body: { password: password || null },
        signal,
        fallback: TRY_AGAIN,
      })
      if (signal.aborted) return
      toast({
        title: password
          ? 'Password protection enabled'
          : 'Password protection removed',
        description: password
          ? 'Visitors need your password to open this file.'
          : 'The file no longer requires a password.',
      })
      setPassword('')
      setIsPasswordDialogOpen(false)
      onUpdate?.()
    } catch (error) {
      if (signal.aborted) return
      toast({
        title: 'Couldn’t update the password',
        description: failure(error),
        variant: 'destructive',
      })
    } finally {
      if (!signal.aborted) setMutation(null)
    }
  }

  const handleVisibilityUpdate = async () => {
    const { signal } = lifetime.current
    if (mutation || signal.aborted) return
    setMutation('visibility')
    try {
      await apiRequest(`/api/files/${file.id}`, {
        method: 'PATCH',
        body: { visibility },
        signal,
        fallback: TRY_AGAIN,
      })
      if (signal.aborted) return
      toast({
        title: 'Visibility updated',
        description: `This file is now ${visibility.toLowerCase()}.`,
      })
      setIsVisibilityDialogOpen(false)
      onUpdate?.()
    } catch (error) {
      if (signal.aborted) return
      toast({
        title: 'Couldn’t update visibility',
        description: failure(error),
        variant: 'destructive',
      })
    } finally {
      if (!signal.aborted) setMutation(null)
    }
  }

  const handleExpiryUpdate = async (
    expiresAt: Date | null,
    action?: ExpiryAction
  ) => {
    const { signal } = lifetime.current
    if (signal.aborted) return
    try {
      await apiRequest(`/api/files/${file.id}/expiry`, {
        ...(expiresAt
          ? {
              body: {
                expiresAt: expiresAt.toISOString(),
                action: action || ExpiryAction.DELETE,
              },
            }
          : { method: 'DELETE' }),
        signal,
        fallback: TRY_AGAIN,
      })
      if (signal.aborted) return
      toast({
        title: expiresAt ? 'Expiration scheduled' : 'Expiration removed',
        description: expiresAt
          ? 'Your file’s expiration has been updated.'
          : 'This file will no longer expire.',
      })
      setIsExpiryModalOpen(false)
      onUpdate?.()
    } catch (error) {
      if (signal.aborted) return
      toast({
        title: 'Couldn’t update expiration',
        description: failure(error),
        variant: 'destructive',
      })
      // ExpiryModal keeps the form open when saving fails.
      throw error
    }
  }

  const isImage = file.mimeType.startsWith('image/')
  const VisibilityIcon = file.visibility === 'PUBLIC' ? Globe : Lock
  const tags = file.tags ?? []
  const visibleTags = tags.slice(0, folder ? 1 : 2)
  const permitted = (id: FileActionId) => fileActionAllowed(user, id)
  const browseArchive = permitted('browseArchive') ? onBrowseArchive : undefined
  // What each action does on this card; one without an entry isn't offered.
  const handlers: Partial<
    Record<
      FileActionId,
      { run?: () => void; href?: string; download?: string; disabled?: boolean }
    >
  > = {
    ...(browseArchive && { browseArchive: { run: browseArchive } }),
    open: { href: urls.page },
    copyLink: { run: () => void handleCopyLink() },
    download: { href: urls.download, download: file.name },
    ...(onEditTags && { editTags: { run: onEditTags } }),
    ...(onMove && { move: { run: onMove } }),
    visibility: {
      run: () => {
        setVisibility(file.visibility)
        setIsVisibilityDialogOpen(true)
      },
    },
    password: { run: () => handlePasswordDialogOpenChange(true) },
    expiration: { run: () => setIsExpiryModalOpen(true) },
    ...(isImage && {
      ocr: { run: () => void ocr.extract(), disabled: ocr.loading },
    }),
    delete: { run: () => setIsDeleteDialogOpen(true) },
  }
  const offered = (id: FileActionId) =>
    permitted(id) ? handlers[id] : undefined
  const hasImagePreview = isImage && !previewFailed
  const imagePreviewClassName = cn(
    fileCardPreviewClassName,
    !onSelect &&
      '[@media(pointer:coarse)]:group-has-[:focus-visible]:h-[136px] [@media(pointer:coarse)]:group-has-[[data-preview-actions]_:focus]:h-[136px]'
  )
  const {
    start: nameStart,
    separator: nameSeparator,
    tail: nameTail,
    extension: nameExtension,
  } = fileCardFilenameParts(file.name)
  // The tag count opens the editor only where the menu offers it.
  const editTags = offered('editTags')

  const openPrimary = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      (browseArchive || (isImage && onPreview)) &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    ) {
      event.preventDefault()
      if (browseArchive) browseArchive()
      else onPreview?.(file)
    }
  }
  const deleteAction = offered('delete')
  const DeleteIcon = FILE_ACTIONS.delete.icon
  const menuGroups = CARD_MENU.map((group) =>
    group.filter((id) => id !== 'delete' && offered(id))
  ).filter((group) => group.length > 0)
  const manageMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'rounded-lg border border-border/50 bg-background/90 shadow-sm hover:bg-background data-[state=open]:bg-accent [&_svg]:size-[16px]',
            hasImagePreview && !isList
              ? 'h-[32px] w-[32px]'
              : 'h-[44px] w-[44px] shrink-0',
            previewFocusClassName
          )}
          aria-label={`Manage ${file.name}`}
          title="Manage file"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={menuSide}
        align={menuSide === 'left' ? 'start' : 'end'}
        data-file-menu=""
        className="group/file-menu flex w-56 min-w-0 max-w-[calc(100vw-32px)] flex-col overflow-hidden"
      >
        <DropdownMenuLabel className="shrink-0">Manage file</DropdownMenuLabel>
        <DropdownMenuSeparator className="shrink-0" />
        {/* Direction cues sit outside the scrolling items, so they
                  never mask focused actions or the menu's border. */}
        <div
          aria-hidden="true"
          className="hidden h-5 shrink-0 items-center justify-center text-[11px] text-muted-foreground group-has-[[data-scroll-above]]/file-menu:flex"
        >
          <span
            data-file-menu-scroll-cue="above"
            className="flex items-center gap-1"
          >
            <ChevronUp className="h-3 w-3" />
            More actions above
          </span>
        </div>
        <div
          ref={scrollFadeRef}
          data-file-menu-scroll=""
          tabIndex={-1}
          onFocus={(event) => {
            if (event.target === event.currentTarget)
              event.currentTarget.closest<HTMLElement>('[role="menu"]')?.focus()
          }}
          className="min-h-0 overflow-y-auto overscroll-contain outline-none [scroll-padding-block:0.25rem]"
        >
          <DropdownMenuLabel
            data-file-menu-filename=""
            className="break-words text-xs font-normal leading-relaxed text-muted-foreground [overflow-wrap:anywhere]"
          >
            {nameStart}
            {nameSeparator}
            {nameTail}
            <span className="whitespace-nowrap">{nameExtension}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {menuGroups.map((group, index) => (
            <Fragment key={index}>
              {index > 0 && <DropdownMenuSeparator />}
              {group.map((id) => {
                const handler = offered(id)
                if (!handler) return null
                const { icon: Icon, menu } = FILE_ACTIONS[id]
                const content = (
                  <>
                    <Icon />
                    {typeof menu === 'function'
                      ? menu({
                          hasPassword: file.hasPassword,
                          busy: ocr.loading,
                        })
                      : menu}
                  </>
                )
                return (
                  <DropdownMenuItem
                    key={id}
                    asChild={!!handler.href}
                    disabled={handler.disabled}
                    onSelect={handler.run}
                  >
                    {!handler.href ? (
                      content
                    ) : handler.download ? (
                      <a href={handler.href} download={handler.download}>
                        {content}
                      </a>
                    ) : (
                      <Link prefetch={false} href={handler.href}>
                        {content}
                      </Link>
                    )}
                  </DropdownMenuItem>
                )
              })}
            </Fragment>
          ))}
        </div>
        <div
          aria-hidden="true"
          className="hidden h-5 shrink-0 items-center justify-center text-[11px] text-muted-foreground group-has-[[data-scroll-below]]/file-menu:flex"
        >
          <span
            data-file-menu-scroll-cue="below"
            className="flex items-center gap-1"
          >
            More actions below
            <ChevronDown className="h-3 w-3" />
          </span>
        </div>
        {deleteAction && (
          <>
            <DropdownMenuSeparator className="shrink-0" />
            <DropdownMenuItem
              data-file-menu-delete=""
              onSelect={deleteAction.run}
              className="min-h-[44px] shrink-0 text-destructive focus:bg-danger/10 focus:text-destructive"
            >
              <DeleteIcon />
              Delete file
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
  const selectionControl = onSelect && (
    <label
      className={cn(
        'flex h-[44px] w-[44px] shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border/50 bg-background/95 shadow-sm',
        hasImagePreview && !isList && 'absolute left-[8px] top-[8px] z-10'
      )}
    >
      <input
        type="checkbox"
        checked={!!selected}
        onChange={onSelect}
        aria-label={`Select ${file.name}`}
        className="h-[16px] w-[16px] cursor-pointer accent-primary"
      />
    </label>
  )
  const statusBadges = (
    <>
      <span
        data-file-visibility=""
        className="inline-flex min-w-0 max-w-full items-center gap-1 whitespace-normal break-words text-muted-foreground [&>svg]:size-[12px] [&>svg]:shrink-0"
      >
        {file.hasPassword ? (
          <KeyRound className="h-3 w-3" />
        ) : (
          <VisibilityIcon className="h-3 w-3" />
        )}
        {fileVisibilityText(file.visibility, file.hasPassword)}
      </span>
      <span
        data-file-uploaded=""
        className="inline-flex min-w-0 max-w-full items-center gap-1 whitespace-normal break-words text-muted-foreground [&>svg]:size-[12px] [&>svg]:shrink-0"
        title={format(new Date(file.uploadedAt), 'PPP p')}
      >
        <Clock className="h-3 w-3" />
        {getRelativeTime(new Date(file.uploadedAt))}
      </span>
    </>
  )
  const expirationBadge = file.expiresAt &&
    !onSelect &&
    permitted('expiration') && (
      <button
        type="button"
        tabIndex={-1}
        data-flare-control=""
        data-flare-wrap=""
        onClick={() => setIsExpiryModalOpen(true)}
        title={`Expiration scheduled for ${format(new Date(file.expiresAt), 'PPP p')}`}
        className={cn(
          'absolute left-[8px] top-[8px] inline-flex min-h-[32px] max-w-[calc(100%-68px)] items-center gap-1 rounded-md border border-border/50 bg-background/90 px-2 py-[4px] text-xs [@container(max-width:12rem)]:static [@container(max-width:12rem)]:mx-[8px] [@container(max-width:12rem)]:my-[4px] [@container(max-width:12rem)]:max-w-[calc(100%-16px)] [@media(pointer:coarse)]:!min-h-[44px]',
          (!hasImagePreview || isList) &&
            'static mx-0 mb-1 max-w-full self-start',
          isList && 'mb-0 flex-none',
          previewFocusClassName
        )}
      >
        <Timer className="h-3 w-3 shrink-0 text-primary" />
        <span className="min-w-0 break-words whitespace-normal">
          Expires{' '}
          {formatDistanceToNow(new Date(file.expiresAt), {
            addSuffix: true,
          })}
        </span>
      </button>
    )

  const filenameLink = (
    <Link
      prefetch={false}
      href={urls.page}
      title={file.name}
      aria-label={file.name}
      aria-haspopup={
        (!hasImagePreview || isList) &&
        (browseArchive || (isImage && onPreview))
          ? 'dialog'
          : undefined
      }
      onClick={hasImagePreview && !isList ? undefined : openPrimary}
      tabIndex={hasImagePreview && !isList ? -1 : undefined}
      data-file-name=""
      data-file-primary={hasImagePreview && !isList ? undefined : ''}
      className={cn(
        'min-w-0 flex-1 whitespace-pre-wrap rounded-sm text-sm font-medium leading-5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [overflow-wrap:anywhere]',
        (!hasImagePreview || isList) && 'flex min-h-[44px] items-center'
      )}
    >
      {file.name}
    </Link>
  )
  const fileLabels = (
    <>
      {(folder || tags.length > 0) && (
        <div
          data-file-labels=""
          className={cn(fileCardLabelsClassName, isList && 'contents')}
        >
          {folder && (
            <button
              type="button"
              onClick={() => onFolderSelect?.(folder.id)}
              disabled={!onFolderSelect}
              title={folder.name}
              aria-label={`Open folder ${folder.name}`}
              data-flare-control=""
              data-file-label=""
              className={cn(
                labelClassName,
                isList && 'flex-none basis-auto max-w-full'
              )}
            >
              <Folder className="h-3 w-3 shrink-0" />
              <span className="min-w-0 break-words whitespace-normal">
                {folder.name}
              </span>
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
              data-flare-control=""
              data-file-label=""
              className={cn(
                labelClassName,
                isList && 'flex-none basis-auto max-w-full'
              )}
            >
              <Tag className="h-3 w-3 shrink-0" />
              <span className="min-w-0 break-words whitespace-normal">
                {tag.name}
              </span>
            </button>
          ))}
          {tags.length > visibleTags.length &&
            (editTags ? (
              <button
                type="button"
                tabIndex={-1}
                onClick={editTags.run}
                data-flare-control=""
                aria-label={`+${tags.length - visibleTags.length}: view all ${tags.length} tags`}
                className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded px-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                +{tags.length - visibleTags.length}
              </button>
            ) : (
              <span
                title={`${tags.length} tags`}
                className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center px-1 text-xs text-muted-foreground [@media(pointer:coarse)]:min-w-11"
              >
                +{tags.length - visibleTags.length}
              </span>
            ))}
        </div>
      )}
    </>
  )
  const fileActivity = (
    <div
      data-file-activity=""
      className={cn(
        fileCardActivityClassName,
        (!hasImagePreview || isList) && 'gap-x-1.5 gap-y-1',
        isList &&
          'm-0 items-start justify-start gap-x-2.5 gap-y-1 [&>span]:mr-0 [&>div]:ml-0'
      )}
    >
      {(!hasImagePreview || isList) && (
        <>
          <span
            data-file-type=""
            className="min-w-0 max-w-full break-words font-medium [overflow-wrap:anywhere]"
          >
            {fileTypeLabel(file.mimeType)}
          </span>
          {statusBadges}
        </>
      )}
      <span className="mr-auto">{formatFileSize(file.size)}</span>
      <div className="ml-auto flex flex-wrap items-center gap-x-3">
        <span
          className="inline-flex items-center gap-1"
          title={`${file.views.toLocaleString()} views`}
        >
          <Eye className="h-3 w-3" aria-hidden="true" />
          <span aria-hidden="true">{compactCount.format(file.views)}</span>
          <span className="sr-only">{file.views.toLocaleString()} views</span>
        </span>
        <span
          className="inline-flex items-center gap-1"
          title={`${file.downloads.toLocaleString()} downloads`}
        >
          <Download className="h-3 w-3" aria-hidden="true" />
          <span aria-hidden="true">{compactCount.format(file.downloads)}</span>
          <span className="sr-only">
            {file.downloads.toLocaleString()} downloads
          </span>
        </span>
      </div>
    </div>
  )
  const hasListLabels = Boolean(folder || tags.length || expirationBadge)

  return (
    <Card
      data-file-card=""
      data-file-view={view}
      data-file-kind={hasImagePreview ? 'image' : 'generic'}
      className={cn(
        'group relative flex h-auto min-w-0 self-start flex-col overflow-hidden rounded-xl border-border/60 bg-panel shadow-sm transition-colors [container-type:inline-size]',
        isList && fileListClassName,
        // Selected cards keep a 2px edge inside the column: the border plus a
        // ring drawn above the thumbnail and the hover veil, so it looks the
        // same on every card and while hovered. The ring sits inside the
        // border, so its corners use the border's inner radius.
        selected
          ? 'border-primary after:pointer-events-none after:absolute after:inset-0 after:z-20 after:rounded-[calc(0.75rem-1px)] after:ring-1 after:ring-inset after:ring-primary'
          : 'hover:border-primary/30'
      )}
    >
      {isList ? (
        <>
          <div className="col-start-1 row-start-1 flex min-h-[44px] w-[64px] items-center justify-center">
            {onSelect ? (
              selectionControl
            ) : hasImagePreview ? (
              <Link
                data-file-preview=""
                prefetch={false}
                href={urls.page}
                aria-label={`Open ${file.name}`}
                aria-haspopup={onPreview ? 'dialog' : undefined}
                tabIndex={-1}
                onClick={openPrimary}
                className={cn(
                  'relative block h-[64px] w-[64px] shrink-0 overflow-hidden rounded-md bg-muted/50',
                  previewFocusClassName
                )}
              >
                <Image
                  src={urls.thumbnail}
                  alt={file.name}
                  fill
                  className="object-cover"
                  sizes="64px"
                  loading="lazy"
                  onError={() => setPreviewFailed(true)}
                  unoptimized={!canOptimizeThumbnail(file)}
                />
              </Link>
            ) : (
              <FileTypeIcon
                file={file}
                className="h-[20px] w-[20px] shrink-0 text-muted-foreground"
              />
            )}
          </div>
          <div data-file-heading="" className={fileListNameClassName}>
            {filenameLink}
          </div>
          <div className={fileListManageClassName}>{manageMenu}</div>
          <div className={fileListFactsClassName}>{fileActivity}</div>
          <div
            className={cn(
              fileListLabelsClassName,
              !hasListLabels && 'hidden lg:block'
            )}
          >
            {fileLabels}
            {expirationBadge}
          </div>
        </>
      ) : (
        <>
          <div
            data-file-heading=""
            className={cn(
              fileCardNameRowClassName,
              !hasImagePreview && 'items-start'
            )}
          >
            {!hasImagePreview &&
              (onSelect ? (
                selectionControl
              ) : (
                <FileTypeIcon
                  file={file}
                  className="mt-[12px] h-[20px] w-[20px] shrink-0 text-muted-foreground"
                />
              ))}
            {filenameLink}
            {!hasImagePreview && manageMenu}
          </div>
          {hasImagePreview && (
            <div className="relative">
              <Link
                data-file-preview=""
                data-file-primary=""
                prefetch={false}
                href={urls.page}
                aria-label={`Open ${file.name}`}
                aria-haspopup={
                  browseArchive || (isImage && onPreview) ? 'dialog' : undefined
                }
                onClick={openPrimary}
                className={cn(
                  'relative block overflow-hidden bg-muted/50 after:pointer-events-none after:absolute after:inset-0 after:z-10 after:hidden after:shadow-[inset_0_0_0_2px_hsl(var(--foreground)),inset_0_0_0_4px_hsl(var(--ring)),inset_0_0_0_7px_hsl(var(--background))] focus-visible:outline-none focus-visible:after:block',
                  imagePreviewClassName
                )}
              >
                <Image
                  src={urls.thumbnail}
                  alt={file.name}
                  fill
                  className="object-cover"
                  sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                  loading="lazy"
                  onError={() => setPreviewFailed(true)}
                  unoptimized={!canOptimizeThumbnail(file)}
                />
              </Link>
              {/* These pointer shortcuts repeat the primary link and menu actions,
            so Tab goes from the primary link to Manage file, then the filters.
            Keyboard focus still exposes the shortcuts and their full labels. */}
              <div
                data-preview-actions=""
                className={cn(
                  'pointer-events-none absolute inset-0 bottom-auto flex items-center justify-center gap-2 bg-background/50 pt-[18px] pb-[8px] opacity-0 transition-opacity focus-within:opacity-100 focus-within:[&>*]:pointer-events-auto group-has-[:focus-visible]:opacity-100 group-has-[:focus-visible]:[&>*]:pointer-events-auto [@media(hover:hover)]:group-hover:[&>*]:pointer-events-auto [@media(hover:hover)]:group-hover:opacity-100',
                  imagePreviewClassName,
                  '[@media(pointer:coarse)]:!pt-[28px] [@media(pointer:coarse)]:!pb-[8px]',
                  onSelect && 'hidden'
                )}
              >
                {browseArchive ? (
                  <Button
                    tabIndex={-1}
                    variant="outline"
                    size={hasImagePreview ? 'sm' : 'icon'}
                    aria-label="Browse archive"
                    title="Browse archive"
                    className={cn('bg-background', previewFocusClassName)}
                    onClick={browseArchive}
                  >
                    {hasImagePreview ? (
                      'Browse archive'
                    ) : (
                      <Folder className="h-4 w-4" />
                    )}
                  </Button>
                ) : isImage && onPreview ? (
                  <>
                    <Button
                      data-preview-text-shortcut={
                        hasImagePreview ? '' : undefined
                      }
                      tabIndex={-1}
                      variant="outline"
                      size={hasImagePreview ? 'sm' : 'icon'}
                      aria-label="View image"
                      title="View image"
                      className={cn('bg-background', previewFocusClassName)}
                      onClick={() => onPreview(file)}
                    >
                      {hasImagePreview ? (
                        'View image'
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                    {hasImagePreview && (
                      <Button
                        data-preview-icon-shortcut=""
                        tabIndex={-1}
                        variant="outline"
                        size="icon"
                        aria-label="View image"
                        title="View image"
                        className={cn(
                          'hidden bg-background',
                          previewFocusClassName
                        )}
                        onClick={() => onPreview(file)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    )}
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      'h-auto bg-background px-[8px] [&[data-flare-control]]:min-h-[44px] [&[data-flare-control]]:min-w-[44px]',
                      previewFocusClassName
                    )}
                    asChild
                  >
                    <Link prefetch={false} href={urls.page} tabIndex={-1}>
                      View
                    </Link>
                  </Button>
                )}
                <div className="flex max-w-[calc(100%-1rem)] flex-wrap justify-center gap-[4px]">
                  {previewActions.map((id) => {
                    const handler = offered(id)
                    if (!handler) return null
                    const { icon: Icon, button } = FILE_ACTIONS[id]
                    const className =
                      'h-[32px] w-[32px] bg-background px-0 [&_svg]:size-[16px]'
                    return handler.href ? (
                      <Button
                        key={id}
                        variant="outline"
                        size="icon"
                        className={cn(className, previewFocusClassName)}
                        asChild
                      >
                        <a
                          tabIndex={-1}
                          href={handler.href}
                          download={handler.download}
                          aria-label={button.label(file.name)}
                          title={button.title}
                        >
                          <Icon className="h-4 w-4" />
                        </a>
                      </Button>
                    ) : (
                      <Button
                        key={id}
                        tabIndex={-1}
                        variant="outline"
                        size="icon"
                        className={cn(className, previewFocusClassName)}
                        disabled={handler.disabled}
                        onClick={handler.run}
                        aria-label={button.label(file.name)}
                        title={button.title}
                      >
                        <Icon className="h-4 w-4" />
                      </Button>
                    )
                  })}
                </div>
              </div>
              {selectionControl}
              <div className="absolute right-[8px] top-[8px] flex">
                {manageMenu}
              </div>
              <div
                data-preview-badges=""
                className="pointer-events-none absolute bottom-2 inset-x-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border/40 bg-background px-[8px] py-[4px] text-xs [@container(max-width:12rem)]:static"
              >
                {statusBadges}
              </div>
              {expirationBadge}
              {ocr.loading && (
                <div
                  role="status"
                  className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/90"
                >
                  <Loader2 className="h-7 w-7 animate-spin text-primary" />
                  <span className="text-sm font-medium">Extracting text…</span>
                </div>
              )}
            </div>
          )}
          <div className={fileCardDetailsClassName}>
            {!hasImagePreview && expirationBadge}
            {fileLabels}
            {fileActivity}
          </div>
        </>
      )}

      {(!hasImagePreview || isList) && ocr.loading && (
        <div
          role="status"
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/90"
        >
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          <span className="text-sm font-medium">Extracting text…</span>
        </div>
      )}

      <Dialog
        open={isPasswordDialogOpen}
        onOpenChange={handlePasswordDialogOpenChange}
      >
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {file.hasPassword ? 'Manage password' : 'Protect this file'}
            </DialogTitle>
            <DialogDescription className="break-words">
              Add another layer of privacy to{' '}
              <span className="font-medium text-foreground">{file.name}</span>.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (passwordHint) return
              if (password || file.hasPassword) void handlePasswordUpdate()
            }}
            className="space-y-5"
          >
            <div className="space-y-2">
              <Label htmlFor={`password-${file.id}`}>
                {file.hasPassword ? 'New password' : 'Password'}
              </Label>
              <Input
                id={`password-${file.id}`}
                type="password"
                autoComplete="new-password"
                value={password}
                disabled={mutation === 'password'}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter a password"
                aria-invalid={Boolean(passwordHint)}
                aria-describedby={`password-hint-${file.id}`}
              />
              <p
                id={`password-hint-${file.id}`}
                className={cn(
                  'text-pretty text-xs',
                  passwordHint ? 'text-destructive' : 'text-muted-foreground'
                )}
              >
                {passwordHint ??
                  (file.hasPassword
                    ? 'Use at least 8 characters, or leave this empty to remove the current password.'
                    : 'Use at least 8 characters. Anyone you share this file with will need this password.')}
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={mutation === 'password'}
                onClick={() => handlePasswordDialogOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  mutation === 'password' ||
                  (!password && !file.hasPassword) ||
                  Boolean(passwordHint)
                }
              >
                {mutation === 'password' && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {file.hasPassword
                  ? password
                    ? 'Update password'
                    : 'Remove password'
                  : 'Add password'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isVisibilityDialogOpen}
        onOpenChange={(open) => {
          if (mutation !== 'visibility') setIsVisibilityDialogOpen(open)
        }}
      >
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Who can open this file?</DialogTitle>
            <DialogDescription className="break-words">
              Choose how you share{' '}
              <span className="font-medium text-foreground">{file.name}</span>.
            </DialogDescription>
          </DialogHeader>
          <RadioGroup
            value={visibility}
            onValueChange={(value) =>
              setVisibility(value as 'PUBLIC' | 'PRIVATE')
            }
            disabled={mutation === 'visibility'}
            className="gap-3"
          >
            {[
              {
                value: 'PUBLIC',
                label: 'Public',
                description:
                  'Anyone with the link can open it. Password protection still applies.',
                icon: Globe,
              },
              {
                value: 'PRIVATE',
                label: 'Private',
                description:
                  'Only you and instance administrators can open it.',
                icon: Lock,
              },
            ].map(({ value, label, description, icon: Icon }) => (
              <Label
                key={value}
                htmlFor={`${file.id}-${value}`}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-xl border p-4',
                  visibility === value && 'border-primary bg-primary/5'
                )}
              >
                <RadioGroupItem
                  value={value}
                  id={`${file.id}-${value}`}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {label}
                  </span>
                  <span className="mt-1 block text-pretty text-xs font-normal leading-5 text-muted-foreground">
                    {description}
                  </span>
                </span>
              </Label>
            ))}
          </RadioGroup>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={mutation === 'visibility'}
              onClick={() => setIsVisibilityDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={
                mutation === 'visibility' || visibility === file.visibility
              }
              onClick={handleVisibilityUpdate}
            >
              {mutation === 'visibility' && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Save visibility
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          if (mutation !== 'delete') setIsDeleteDialogOpen(open)
        }}
      >
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this file?</DialogTitle>
            <DialogDescription className="break-words">
              <span className="font-medium text-foreground">{file.name}</span>{' '}
              will be permanently deleted and its shared link will stop working.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={mutation === 'delete'}
              onClick={() => setIsDeleteDialogOpen(false)}
            >
              Keep file
            </Button>
            <Button
              variant="destructive"
              disabled={mutation === 'delete'}
              onClick={handleDelete}
            >
              {mutation === 'delete' && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Delete file
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <OcrDialog {...ocr.dialog} filename={file.name} />
      <ExpiryModal
        isOpen={isExpiryModalOpen}
        onOpenChange={setIsExpiryModalOpen}
        onConfirm={handleExpiryUpdate}
        initialDate={file.expiresAt ? new Date(file.expiresAt) : null}
        initialAction={file.expiryAction ?? undefined}
        title="Manage expiration"
        description="Choose when this file is deleted or made private."
      />
    </Card>
  )
}
