'use client'

import { useState } from 'react'

import Image from 'next/image'
import Link from 'next/link'

import { FileType } from '@/types/components/file'
import { ExpiryAction } from '@/types/events'
import { format, formatDistanceToNow } from 'date-fns'
import {
  ArrowUpRight,
  Clock,
  Download,
  Eye,
  Folder,
  FolderInput,
  Globe,
  KeyRound,
  Link as LinkIcon,
  Loader2,
  Lock,
  MoreHorizontal,
  ScanText,
  Tag,
  Timer,
  Trash2,
} from 'lucide-react'

import { getFileIcon } from '@/components/dashboard/file-card/utils'
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

import type { FolderView } from '@/lib/folders/schema'
import { cn, formatFileSize, getRelativeTime } from '@/lib/utils'
import { sanitizeUrl } from '@/lib/utils/url'

import { useToast } from '@/hooks/use-toast'

interface FileCardProps {
  file: FileType
  onDelete?: (id: string) => void
  onUpdate?: () => void
  onPreview?: (file: FileType) => void
  onEditTags?: () => void
  onTagSelect?: (id: string) => void
  onMove?: () => void
  folder?: FolderView
  onFolderSelect?: (id: string) => void
  selected?: boolean
  onSelect?: () => void
}

export function FileCard({
  file: initialFile,
  onDelete,
  onUpdate,
  onPreview,
  onEditTags,
  onTagSelect,
  onMove,
  folder,
  onFolderSelect,
  selected,
  onSelect,
}: FileCardProps) {
  const { toast } = useToast()
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false)
  const [isVisibilityDialogOpen, setIsVisibilityDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [file, setFile] = useState(() => {
    const { password: legacyPassword, ...metadata } = initialFile
    return {
      ...metadata,
      hasPassword: initialFile.hasPassword ?? Boolean(legacyPassword),
    }
  })
  const [visibility, setVisibility] = useState<'PUBLIC' | 'PRIVATE'>(
    file.visibility
  )
  const [isDeleted, setIsDeleted] = useState(false)
  const [mutation, setMutation] = useState<
    'delete' | 'password' | 'visibility' | null
  >(null)
  const [isLoadingOcr, setIsLoadingOcr] = useState(false)
  const [ocrText, setOcrText] = useState<string | null>(null)
  const [isOcrDialogOpen, setIsOcrDialogOpen] = useState(false)
  const [ocrError, setOcrError] = useState<string | null>(null)
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null)
  const [isExpiryModalOpen, setIsExpiryModalOpen] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)

  const handlePasswordDialogOpenChange = (open: boolean) => {
    if (mutation === 'password') return
    setPassword('')
    setIsPasswordDialogOpen(open)
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${sanitizeUrl(file.urlPath)}`
      )
      toast({
        title: 'Link copied',
        description: 'Your file is ready to share.',
      })
    } catch {
      toast({
        title: 'Couldn’t copy the link',
        description: 'Open the file and copy its address from your browser.',
        variant: 'destructive',
      })
    }
  }

  const handleDelete = async () => {
    if (mutation) return
    setMutation('delete')
    try {
      const response = await fetch(`/api/files/${file.id}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error()
      setIsDeleteDialogOpen(false)
      setIsDeleted(true)
      onDelete?.(file.id)
      toast({
        title: 'File deleted',
        description: 'The file has been permanently deleted.',
      })
    } catch {
      toast({
        title: 'Couldn’t delete this file',
        description: 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setMutation(null)
    }
  }

  const handlePasswordUpdate = async () => {
    if (mutation) return
    setMutation('password')
    try {
      const response = await fetch(`/api/files/${file.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password || null }),
      })
      if (!response.ok) throw new Error()
      toast({
        title: password
          ? 'Password protection enabled'
          : 'Password protection removed',
        description: password
          ? 'Visitors need your password to open this file.'
          : 'The file no longer requires a password.',
      })
      setFile((previous) => ({ ...previous, hasPassword: Boolean(password) }))
      setPassword('')
      setIsPasswordDialogOpen(false)
      onUpdate?.()
    } catch {
      toast({
        title: 'Couldn’t update the password',
        description: 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setMutation(null)
    }
  }

  const handleVisibilityUpdate = async () => {
    if (mutation) return
    setMutation('visibility')
    try {
      const response = await fetch(`/api/files/${file.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility }),
      })
      if (!response.ok) throw new Error()
      toast({
        title: 'Visibility updated',
        description: `This file is now ${visibility.toLowerCase()}.`,
      })
      setIsVisibilityDialogOpen(false)
      setFile((previous) => ({ ...previous, visibility }))
      onUpdate?.()
    } catch {
      toast({
        title: 'Couldn’t update visibility',
        description: 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setMutation(null)
    }
  }

  const handleFetchOcr = async () => {
    setIsLoadingOcr(true)
    setOcrError(null)
    try {
      const response = await fetch(`/api/files/${file.id}/ocr`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to process OCR')
      if (!data.success) {
        setOcrError(data.error || 'There was an error processing the image')
        setOcrText(null)
        setOcrConfidence(null)
      } else {
        setOcrText(data.text)
        setOcrConfidence(data.confidence)
      }
      setIsOcrDialogOpen(true)
    } catch (error) {
      toast({
        title: 'Couldn’t extract text',
        description:
          error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setIsLoadingOcr(false)
    }
  }

  const handleExpiryUpdate = async (
    expiresAt: Date | null,
    action?: ExpiryAction
  ) => {
    try {
      const response = await fetch(
        `/api/files/${file.id}/expiry`,
        expiresAt
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                expiresAt: expiresAt.toISOString(),
                action: action || ExpiryAction.DELETE,
              }),
            }
          : { method: 'DELETE' }
      )
      if (!response.ok) throw new Error('Failed to update expiration')
      toast({
        title: expiresAt ? 'Expiration scheduled' : 'Expiration removed',
        description: expiresAt
          ? 'Your file’s expiration has been updated.'
          : 'This file will no longer expire.',
      })
      setFile((previous) => ({
        ...previous,
        expiresAt: expiresAt?.toISOString() || null,
      }))
      setIsExpiryModalOpen(false)
      onUpdate?.()
    } catch (error) {
      toast({
        title: 'Couldn’t update expiration',
        description: 'Please try again.',
        variant: 'destructive',
      })
      // ExpiryModal keeps the form open when saving fails.
      throw error
    }
  }

  if (isDeleted) return null

  const isImage = file.mimeType.startsWith('image/')
  const visibilityLabel = file.visibility === 'PUBLIC' ? 'Public' : 'Private'
  const VisibilityIcon = file.visibility === 'PUBLIC' ? Globe : Lock
  const safeUrl = sanitizeUrl(file.urlPath)

  return (
    <Card
      className={cn(
        'group relative min-w-0 overflow-hidden rounded-xl border-border/60 bg-background/70 shadow-sm backdrop-blur-xl transition-colors hover:border-primary/30 hover:bg-background/90',
        selected && 'ring-2 ring-primary'
      )}
    >
      <div className="relative">
        <Link
          href={safeUrl}
          aria-label={`Open ${file.name}`}
          aria-haspopup={isImage && onPreview ? 'dialog' : undefined}
          onClick={(event) => {
            if (
              isImage &&
              onPreview &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.shiftKey &&
              !event.altKey
            ) {
              event.preventDefault()
              onPreview(file)
            }
          }}
          className="relative block aspect-square overflow-hidden bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {isImage && !previewFailed ? (
            <Image
              src={`/api/files/${file.id}/thumbnail`}
              alt={file.name}
              fill
              className="object-cover"
              sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              loading="lazy"
              onError={() => setPreviewFailed(true)}
              unoptimized={
                file.visibility === 'PRIVATE' ||
                file.hasPassword ||
                file.mimeType === 'image/gif'
              }
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              {getFileIcon(file.mimeType, 'h-16 w-16 text-muted-foreground')}
            </div>
          )}
        </Link>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/55 opacity-0 transition-opacity group-focus-within:[&>*]:pointer-events-auto group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:[&>*]:pointer-events-auto [@media(hover:hover)]:group-hover:opacity-100">
          {isImage && onPreview ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onPreview(file)}
            >
              View image
            </Button>
          ) : (
            <Button variant="secondary" size="sm" asChild>
              <Link href={safeUrl}>View</Link>
            </Button>
          )}
          <div className="flex max-w-[calc(100%-1rem)] flex-wrap justify-center gap-1">
            <Button
              variant="secondary"
              size="icon"
              className="h-8 w-8"
              onClick={handleCopyLink}
              aria-label={`Copy link to ${file.name}`}
              title="Copy link"
            >
              <LinkIcon className="h-4 w-4" />
            </Button>
            <Button variant="secondary" size="icon" className="h-8 w-8" asChild>
              <a
                href={`/api/files/${file.id}/download`}
                download={file.name}
                aria-label={`Download ${file.name}`}
                title="Download"
              >
                <Download className="h-4 w-4" />
              </a>
            </Button>
            <Button
              variant="secondary"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                setVisibility(file.visibility)
                setIsVisibilityDialogOpen(true)
              }}
              aria-label={`Change visibility of ${file.name}`}
              title="Change visibility"
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              className="h-8 w-8"
              onClick={() => handlePasswordDialogOpenChange(true)}
              aria-label={`Password protection for ${file.name}`}
              title="Password protection"
            >
              <KeyRound className="h-4 w-4" />
            </Button>
            {isImage && (
              <Button
                variant="secondary"
                size="icon"
                className="h-8 w-8"
                disabled={isLoadingOcr}
                onClick={() => void handleFetchOcr()}
                aria-label={`Extract text from ${file.name}`}
                title="Extract text (OCR)"
              >
                <ScanText className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="secondary"
              size="icon"
              className="h-8 w-8"
              onClick={() => setIsExpiryModalOpen(true)}
              aria-label={`Manage expiration of ${file.name}`}
              title="Manage expiration"
            >
              <Timer className="h-4 w-4" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              className="h-8 w-8 hover:bg-destructive hover:text-destructive-foreground"
              onClick={() => setIsDeleteDialogOpen(true)}
              aria-label={`Delete ${file.name}`}
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
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
                className="h-8 w-8 rounded-lg border border-border/50 bg-background/90 shadow-sm hover:bg-background"
                aria-label={`Manage ${file.name}`}
                title="Manage file"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 bg-popover">
              <DropdownMenuLabel>Manage file</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href={safeUrl}>
                  <ArrowUpRight />
                  Open file
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void handleCopyLink()}>
                <LinkIcon />
                Copy link
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={`/api/files/${file.id}/download`} download={file.name}>
                  <Download />
                  Download file
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {onEditTags && (
                <DropdownMenuItem onSelect={onEditTags}>
                  <Tag />
                  Edit tags
                </DropdownMenuItem>
              )}
              {onMove && (
                <DropdownMenuItem onSelect={onMove}>
                  <FolderInput />
                  Move to folder
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() => {
                  setVisibility(file.visibility)
                  setIsVisibilityDialogOpen(true)
                }}
              >
                <Eye />
                Change visibility
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => handlePasswordDialogOpenChange(true)}
              >
                <KeyRound />
                {file.hasPassword ? 'Manage password' : 'Add password'}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setIsExpiryModalOpen(true)}>
                <Timer />
                Manage expiration
              </DropdownMenuItem>
              {isImage && (
                <DropdownMenuItem
                  disabled={isLoadingOcr}
                  onSelect={() => void handleFetchOcr()}
                >
                  <ScanText />
                  {isLoadingOcr ? 'Extracting text…' : 'Extract text (OCR)'}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                onSelect={() => setIsDeleteDialogOpen(true)}
              >
                <Trash2 />
                Delete file
              </DropdownMenuItem>
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
            className="inline-flex items-center gap-1 rounded-md border border-border/40 bg-background/90 px-2 py-1 backdrop-blur-sm"
            title={format(new Date(file.uploadedAt), 'PPP p')}
          >
            <Clock className="h-3 w-3" />
            {getRelativeTime(new Date(file.uploadedAt))}
          </span>
        </div>
        {file.expiresAt && !onSelect && (
          <button
            type="button"
            onClick={() => setIsExpiryModalOpen(true)}
            title={`Expiration scheduled for ${format(new Date(file.expiresAt), 'PPP p')}`}
            className="absolute left-2 top-2 inline-flex max-w-[calc(100%-3.5rem)] items-center gap-1 rounded-md border border-border/50 bg-background/90 px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Timer className="h-3 w-3 shrink-0 text-primary" />
            <span className="truncate">
              {formatDistanceToNow(new Date(file.expiresAt), {
                addSuffix: true,
              })}
            </span>
          </button>
        )}
        {isLoadingOcr && (
          <div
            role="status"
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/90"
          >
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
            <span className="text-sm font-medium">Extracting text…</span>
          </div>
        )}
      </div>
      <div className="border-t border-border/40 p-3">
        <div className="flex items-center justify-between gap-2">
          <Link
            href={safeUrl}
            title={file.name}
            className="min-w-0 truncate rounded-sm text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {file.name}
          </Link>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatFileSize(file.size)}
          </span>
        </div>
        {folder && (
          <button
            type="button"
            onClick={() => onFolderSelect?.(folder.id)}
            disabled={!onFolderSelect}
            title={folder.name}
            aria-label={`Open folder ${folder.name}`}
            className="mt-2 flex max-w-full items-center gap-1.5 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Folder className="h-3 w-3 shrink-0" />
            <span className="truncate">{folder.name}</span>
          </button>
        )}
        {!!initialFile.tags?.length && (
          <div className="mt-2 flex items-center gap-1.5">
            {initialFile.tags.slice(0, 2).map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => onTagSelect?.(tag.id)}
                disabled={!onTagSelect}
                title={tag.name}
                aria-label={`Show files tagged ${tag.name}`}
                className="inline-flex min-w-0 items-center gap-1 rounded-md bg-muted/70 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
              >
                <Tag className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{tag.name}</span>
              </button>
            ))}
            {initialFile.tags.length > 2 && (
              <button
                type="button"
                onClick={onEditTags}
                aria-label={`View all ${initialFile.tags.length} tags`}
                className="shrink-0 rounded px-1 text-[11px] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                +{initialFile.tags.length - 2}
              </button>
            )}
          </div>
        )}
        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
          <span
            className="inline-flex items-center gap-1"
            aria-label={`${file.views} views`}
          >
            <Eye className="h-3 w-3" />
            {file.views.toLocaleString()}
          </span>
          <span
            className="inline-flex items-center gap-1"
            aria-label={`${file.downloads} downloads`}
          >
            <Download className="h-3 w-3" />
            {file.downloads.toLocaleString()}
          </span>
        </div>
      </div>

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
              Add another layer of privacy to {file.name}.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault()
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
              />
              <p className="text-xs leading-5 text-muted-foreground">
                {file.hasPassword
                  ? 'Leave this empty to remove the current password.'
                  : 'Anyone you share this file with will need this password.'}
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
                  mutation === 'password' || (!password && !file.hasPassword)
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
              Choose how you share {file.name}.
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
                  visibility === value && 'border-primary/40 bg-primary/5'
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
                  <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
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
              {file.name} will be permanently deleted and its shared link will
              stop working. This cannot be undone.
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
      <OcrDialog
        isOpen={isOcrDialogOpen}
        onOpenChange={setIsOcrDialogOpen}
        text={ocrText}
        error={ocrError}
        confidence={ocrConfidence}
        filename={file.name}
      />
      <ExpiryModal
        isOpen={isExpiryModalOpen}
        onOpenChange={setIsExpiryModalOpen}
        onConfirm={handleExpiryUpdate}
        initialDate={file.expiresAt ? new Date(file.expiresAt) : null}
        title="Manage expiration"
        description="Choose when this file is deleted or made private."
      />
    </Card>
  )
}
