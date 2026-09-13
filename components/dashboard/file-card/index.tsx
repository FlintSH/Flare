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
  Globe,
  KeyRound,
  Link as LinkIcon,
  Loader2,
  Lock,
  MoreHorizontal,
  ScanText,
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

import { cn, formatFileSize, getRelativeTime } from '@/lib/utils'
import { sanitizeUrl } from '@/lib/utils/url'

import { useToast } from '@/hooks/use-toast'

interface FileCardProps {
  file: FileType
  onDelete?: (id: string) => void
  onUpdate?: () => void
}

export function FileCard({
  file: initialFile,
  onDelete,
  onUpdate,
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
  const fileExtension = file.name.includes('.')
    ? file.name.split('.').pop()?.slice(0, 12).toUpperCase()
    : 'FILE'
  const visibilityLabel = file.visibility === 'PUBLIC' ? 'Public' : 'Private'
  const VisibilityIcon = file.visibility === 'PUBLIC' ? Globe : Lock
  const safeUrl = sanitizeUrl(file.urlPath)

  return (
    <Card className="group min-w-0 overflow-hidden rounded-2xl border bg-card shadow-none transition-colors hover:border-primary/30">
      <div className="relative border-b">
        <Link
          href={safeUrl}
          aria-label={`Open ${file.name}`}
          className="relative block aspect-[4/3] overflow-hidden bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {isImage && !previewFailed ? (
            <Image
              src={`/api/files/${file.id}/thumbnail`}
              alt={file.name}
              fill
              className="object-cover transition-transform duration-300 motion-safe:group-hover:scale-[1.03]"
              sizes="(min-width: 1536px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              loading="lazy"
              onError={() => setPreviewFailed(true)}
              // Direct requests preserve the viewer's session for restricted
              // files and keep animated GIFs intact.
              unoptimized={
                file.visibility === 'PRIVATE' ||
                file.hasPassword ||
                file.mimeType === 'image/gif'
              }
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <div className="rounded-2xl border bg-card p-5 text-primary/80">
                {getFileIcon(file.mimeType, 'h-9 w-9')}
              </div>
              <span className="text-xs font-medium tracking-wider text-muted-foreground">
                {fileExtension}
              </span>
            </div>
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
        </Link>
        <div className="pointer-events-none absolute left-3 top-3 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-lg border bg-background/95 px-2 py-1 text-[11px] font-medium shadow-sm">
            <VisibilityIcon className="h-3 w-3" />
            {visibilityLabel}
          </span>
          {file.hasPassword && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border bg-background/95 px-2 py-1 text-[11px] font-medium shadow-sm">
              <KeyRound className="h-3 w-3" />
              Protected
            </span>
          )}
        </div>
        {file.expiresAt && (
          <button
            type="button"
            onClick={() => setIsExpiryModalOpen(true)}
            title={`Expiration scheduled for ${format(new Date(file.expiresAt), 'PPP p')}`}
            className="absolute bottom-3 left-3 inline-flex max-w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-lg border bg-background/95 px-2 py-1 text-[11px] font-medium shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Timer className="h-3 w-3 shrink-0" />
            <span className="truncate">
              Expires{' '}
              {formatDistanceToNow(new Date(file.expiresAt), {
                addSuffix: true,
              })}
            </span>
          </button>
        )}
      </div>
      <div className="p-4">
        <Link
          href={safeUrl}
          title={file.name}
          className="flex items-center gap-2 rounded-sm text-sm font-semibold hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate">{file.name}</span>
          <ArrowUpRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{formatFileSize(file.size)}</span>
          <span
            className="inline-flex items-center gap-1"
            title={format(new Date(file.uploadedAt), 'PPP p')}
          >
            <Clock className="h-3 w-3" />
            {getRelativeTime(new Date(file.uploadedAt))}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
          <span
            className="inline-flex items-center gap-1.5"
            aria-label={`${file.views} views`}
          >
            <Eye className="h-3.5 w-3.5" />
            {file.views.toLocaleString()}
          </span>
          <span
            className="inline-flex items-center gap-1.5"
            aria-label={`${file.downloads} downloads`}
          >
            <Download className="h-3.5 w-3.5" />
            {file.downloads.toLocaleString()}
          </span>
        </div>
        <div className="mt-4 flex items-center gap-1.5 border-t pt-3">
          <Button
            variant="outline"
            size="sm"
            className="mr-auto h-8 rounded-lg px-2.5 text-xs"
            onClick={handleCopyLink}
          >
            <LinkIcon className="mr-1.5 h-3.5 w-3.5" />
            Copy link
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg"
            asChild
          >
            <a
              href={`/api/files/${file.id}/download`}
              download={file.name}
              aria-label={`Download ${file.name}`}
              title="Download file"
            >
              <Download className="h-4 w-4" />
            </a>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-lg"
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
