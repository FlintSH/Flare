'use client'

import { Fragment, useState } from 'react'

import Image from 'next/image'
import Link from 'next/link'

import { FileType } from '@/types/components/file'
import { ExpiryAction } from '@/types/events'
import { format, formatDistanceToNow } from 'date-fns'
import {
  Clock,
  Download,
  Eye,
  Folder,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  LockKeyhole,
  MoreHorizontal,
  ShieldCheck,
  ShieldOff,
  Tag,
  Timer,
  Trash2,
} from 'lucide-react'

import { isArchiveCandidate } from '@/components/archives/archive-utils'
import {
  CARD_BUTTONS,
  CARD_MENU,
  FILE_ACTIONS,
  type FileActionId,
  fileActionAllowed,
} from '@/components/dashboard/file-card/actions'
import { EncryptedFilePasswordDialog } from '@/components/encryption/file-password-dialog'
import { UnlockDialog } from '@/components/encryption/unlock-dialog'
import { FileTypeIcon } from '@/components/file/file-type-icon'
import { SealedThumbnail } from '@/components/file/sealed-thumbnail'
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
import { type OpenedFile, shareSecretOf } from '@/lib/e2ee/client/files'
import { shareLink } from '@/lib/e2ee/link'
import {
  decryptionProblem,
  downloadDecrypted,
} from '@/lib/files/encrypted-client'
import { filePasswordHint } from '@/lib/files/password-policy'
import { normalizedType, safeFileName } from '@/lib/files/safe-render'
import { thumbnailKind } from '@/lib/files/thumbnail-client'
import { canOptimizeThumbnail, fileUrls } from '@/lib/files/urls'
import type { FolderView } from '@/lib/folders/schema'
import { requestMaintenance } from '@/lib/library/browser-maintenance'
import { canReadText } from '@/lib/ocr/encrypted-client'
import { cn, formatFileSize, getRelativeTime } from '@/lib/utils'
import { mbToBytes } from '@/lib/utils/size'

import { useEncryptedFile } from '@/hooks/use-encrypted-file'
import { useOcr } from '@/hooks/use-ocr'
import { usePermissions } from '@/hooks/use-permissions'
import { useRequestLifetime } from '@/hooks/use-request-lifetime'
import { useNamedTags } from '@/hooks/use-tags'
import { useToast } from '@/hooks/use-toast'

// Folder and tag labels share one fixed-height line with the activity counts,
// so every card in the grid keeps the same height. Each name is capped so a
// long label cannot crowd out a short one in narrow cards, and counts from
// 1,000 are abbreviated (1.4K) so large numbers leave room for the labels.
const labelClassName =
  'inline-flex h-5 min-w-0 items-center gap-1 overflow-hidden rounded-md border border-border/60 bg-muted/70 px-1.5 text-[11px] leading-4 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none'
const compactCount = new Intl.NumberFormat(undefined, { notation: 'compact' })

const TRY_AGAIN = 'Please try again.'
const failure = (error: unknown) =>
  error instanceof RefusedRequest ? error.message : TRY_AGAIN

interface FileCardProps {
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
 * One file in the library. A plain file shows as the server sent it. An
 * encrypted file shows its name and type once this browser opened them with
 * the account key (docs/e2ee-spec.md, section 9.3), and a locked placeholder
 * until then.
 */
export function FileCard(props: FileCardProps) {
  const encryption = useEncryptedFile(props.file)
  if (!encryption) return <OpenFileCard {...props} />
  // After a reset without the recovery phrase, no key of the account opens
  // this file (docs/e2ee-spec.md, section 6.9). The owner can delete it.
  if (props.file.unreadable)
    return <LockedFileCard {...props} state="unreadable" />
  if (encryption.status !== 'open')
    return <LockedFileCard {...props} state={encryption.status} />
  const { opened } = encryption
  return (
    <OpenFileCard
      {...props}
      opened={opened}
      file={{
        ...props.file,
        // Decrypted text is not trusted: it is cleaned before it is shown.
        name: safeFileName(opened.name),
        mimeType: normalizedType(opened.type) || 'application/octet-stream',
      }}
      // Thumbnails and the image gallery read file content on the server,
      // which holds only ciphertext. An archive is read in this browser
      // (docs/e2ee-spec.md, section 12.3), so the decrypted name decides.
      onPreview={undefined}
      onBrowseArchive={
        isArchiveCandidate(
          safeFileName(opened.name),
          normalizedType(opened.type)
        )
          ? props.onBrowseArchive
          : undefined
      }
    />
  )
}

/**
 * An encrypted file this browser cannot open yet. It keeps the size of a
 * card, so the grid does not move when the keys unlock.
 */
function LockedFileCard({
  file,
  state,
  selected,
  onSelect,
  onDelete,
}: FileCardProps & {
  state: 'locked' | 'opening' | 'failed' | 'unreadable'
}) {
  const { user } = usePermissions()
  const { toast } = useToast()
  const [unlocking, setUnlocking] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const canDelete =
    state === 'unreadable' && fileActionAllowed(user, 'delete') && !!onDelete
  const remove = async () => {
    if (deleting) return
    setDeleting(true)
    try {
      await apiRequest(`/api/files/${file.id}`, {
        method: 'DELETE',
        fallback: TRY_AGAIN,
      })
      setConfirming(false)
      onDelete?.(file.id)
      toast({
        title: 'File deleted',
        description: 'The file has been permanently deleted.',
      })
    } catch (error) {
      toast({
        title: 'Couldn’t delete this file',
        description: failure(error),
        variant: 'destructive',
      })
    } finally {
      setDeleting(false)
    }
  }
  return (
    <Card
      data-encrypted-file={state}
      className={cn(
        'relative min-w-0 overflow-hidden rounded-xl border-border/60 bg-card/80 shadow-sm backdrop-blur-xl',
        selected && 'border-primary'
      )}
    >
      <div className="relative flex aspect-square flex-col items-center justify-center gap-3 bg-muted/50 px-4 text-center">
        {state === 'opening' ? (
          <Loader2
            className="h-8 w-8 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        ) : (
          <LockKeyhole
            className="h-10 w-10 text-muted-foreground"
            aria-hidden="true"
          />
        )}
        <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
          {state === 'locked'
            ? 'Unlock your keys to see this file.'
            : state === 'opening'
              ? 'Decrypting…'
              : state === 'unreadable'
                ? 'This file was encrypted for keys that were reset. It cannot be opened here.'
                : 'Your keys do not open this file.'}
        </p>
        {canDelete && (
          <Button
            variant="outline"
            size="sm"
            className="bg-background"
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Delete
          </Button>
        )}
        {state === 'locked' && (
          <Button
            variant="outline"
            size="sm"
            className="bg-background"
            onClick={() => setUnlocking(true)}
          >
            Unlock
          </Button>
        )}
        {onSelect && (
          <label className="absolute left-2 top-2 z-10 flex cursor-pointer items-center rounded-lg border border-border/50 bg-background/95 p-2 shadow-sm">
            <input
              type="checkbox"
              checked={!!selected}
              onChange={onSelect}
              aria-label="Select encrypted file"
              className="h-4 w-4 cursor-pointer accent-primary"
            />
          </label>
        )}
        <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-end justify-between gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-md border border-border/40 bg-background/90 px-2 py-1">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
            Encrypted
          </span>
          <span
            className="inline-flex items-center gap-1 rounded-md border border-border/40 bg-background/90 px-2 py-1"
            title={format(new Date(file.uploadedAt), 'PPP p')}
          >
            <Clock className="h-3 w-3" aria-hidden="true" />
            {getRelativeTime(new Date(file.uploadedAt))}
          </span>
        </div>
      </div>
      <div className="border-t border-border/40 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-muted-foreground">
            {state === 'unreadable' ? 'Unreadable file' : 'Encrypted file'}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatFileSize(file.size)}
          </span>
        </div>
        <div className="mt-1 flex h-5 items-center text-xs text-muted-foreground">
          {file.visibility === 'PUBLIC' ? 'Public' : 'Private'}
        </div>
      </div>
      <UnlockDialog open={unlocking} onOpenChange={setUnlocking} />
      {canDelete && (
        <Dialog
          open={confirming}
          onOpenChange={(open) => {
            if (!deleting) setConfirming(open)
          }}
        >
          <DialogContent className="rounded-2xl sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete this file?</DialogTitle>
              <DialogDescription>
                No key of your account opens this file since your passphrase was
                reset without the recovery phrase. A person who has its share
                link can still open it until you delete it. This cannot be
                undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={deleting}
                onClick={() => setConfirming(false)}
              >
                Keep file
              </Button>
              <Button
                variant="destructive"
                disabled={deleting}
                onClick={() => void remove()}
              >
                {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Delete file
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  )
}

/**
 * A file the browser can show. It shows the file it is given; each action
 * ends by asking the library to reload, which brings the changed file.
 * `opened` is set for an encrypted file: its actions then run in this
 * browser, with the file's key.
 */
function OpenFileCard({
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
  opened,
}: FileCardProps & { opened?: OpenedFile }) {
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
  // The server reads a plain image. This browser reads an encrypted one,
  // and stores the text sealed (docs/e2ee-spec.md, section 9.6).
  const readable = opened ? canReadText(opened.type) : false
  const ocr = useOcr(
    urls.ocr,
    opened && readable ? { file, opened, store: true } : null
  )
  const [isExpiryModalOpen, setIsExpiryModalOpen] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const handlePasswordDialogOpenChange = (open: boolean) => {
    if (mutation === 'password') return
    setPassword('')
    setIsPasswordDialogOpen(open)
  }

  const handleCopyLink = async () => {
    const { signal } = lifetime.current
    if (signal.aborted) return
    try {
      const page = fileUrls(file, { origin: window.location.origin }).page
      await navigator.clipboard.writeText(
        // The key goes after `#`, which browsers do not send to a server
        // (docs/e2ee-spec.md, section 10.3).
        opened
          ? shareLink(
              page,
              shareSecretOf(opened, file.encryption?.passwordStanza)
            )
          : page
      )
      if (signal.aborted) return
      toast({
        title: 'Link copied',
        description: opened
          ? file.hasPassword
            ? 'The link opens the file together with its password.'
            : 'The link holds the key. Anyone who has it can open the file.'
          : 'Your file is ready to share.',
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

  const handleDownload = async () => {
    const { signal } = lifetime.current
    if (!opened || downloading || signal.aborted) return
    setDownloading(true)
    try {
      // Streamed to disk by the service worker where there is one, and
      // decrypted in memory first where there is none. Either way a file
      // that fails its integrity check is not kept.
      await downloadDecrypted(
        {
          id: file.id,
          urlPath: file.urlPath,
          header: file.encryption?.header ?? '',
          sizeBytes: Math.round(mbToBytes(file.size)),
        },
        opened,
        { signal }
      )
    } catch (error) {
      if (signal.aborted) return
      toast({
        title: 'Couldn’t download this file',
        description: decryptionProblem(error),
        variant: 'destructive',
      })
    } finally {
      if (!signal.aborted) setDownloading(false)
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
      // A file that became public in a folder needs its folder stanza
      // (docs/e2ee-spec.md, section 9.4.4).
      if (file.encrypted) requestMaintenance('folders')
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

  // The server makes the preview of a plain image. An encrypted file shows
  // the thumbnail that a browser sealed for it.
  const isImage = !opened && file.mimeType.startsWith('image/')
  // The icon steps aside for the hover and focus controls, so it doesn't
  // show through between them.
  const typeIcon = (
    <div className="flex h-full items-center justify-center transition-opacity group-has-[:focus-visible]:opacity-0 [@media(hover:hover)]:group-hover:opacity-0">
      <FileTypeIcon file={file} className="h-16 w-16 text-muted-foreground" />
    </div>
  )
  const visibilityLabel = file.visibility === 'PUBLIC' ? 'Public' : 'Private'
  const VisibilityIcon = file.visibility === 'PUBLIC' ? Globe : Lock
  // The server lists a sealed tag by its ID. Its name is opened here.
  const tags = useNamedTags(file.tags)
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
    download: opened
      ? { run: () => void handleDownload(), disabled: downloading }
      : { href: urls.download, download: file.name },
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
    ...((isImage || readable) && {
      ocr: { run: () => void ocr.extract(), disabled: ocr.loading },
    }),
    delete: { run: () => setIsDeleteDialogOpen(true) },
  }
  const offered = (id: FileActionId) =>
    permitted(id) ? handlers[id] : undefined
  // The tag count opens the editor only where the menu offers it.
  const editTags = offered('editTags')

  return (
    <Card
      className={cn(
        'group relative min-w-0 overflow-hidden rounded-xl border-border/60 bg-card/80 shadow-sm backdrop-blur-xl transition-colors hover:bg-card/95',
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
          aria-haspopup={
            browseArchive || (isImage && onPreview) ? 'dialog' : undefined
          }
          onClick={(event) => {
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
          }}
          className="relative block aspect-square overflow-hidden bg-muted/50 after:pointer-events-none after:absolute after:inset-0 after:z-10 after:hidden after:ring-2 after:ring-inset after:ring-ring focus-visible:outline-none focus-visible:after:block"
        >
          {isImage && !previewFailed ? (
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
          ) : opened &&
            thumbnailKind(file.mimeType) &&
            !file.thumbnailPending ? (
            // The sealed thumbnail, opened in this browser with the file key
            // (docs/e2ee-spec.md, section 12.1).
            <SealedThumbnail
              fileId={file.id}
              opened={opened}
              alt={file.name}
              className="absolute inset-0 h-full w-full object-cover"
              fallback={typeIcon}
            />
          ) : (
            typeIcon
          )}
        </Link>
        {/* Hover and keyboard focus veil the preview halfway toward the page
            colour, in both themes, with solid buttons on top. Only keyboard
            focus counts, so a tap on a phone doesn't leave the card veiled. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/50 opacity-0 transition-opacity group-has-[:focus-visible]:opacity-100 group-has-[:focus-visible]:[&>*]:pointer-events-auto [@media(hover:hover)]:group-hover:[&>*]:pointer-events-auto [@media(hover:hover)]:group-hover:opacity-100">
          {browseArchive ? (
            <Button
              variant="outline"
              size="sm"
              className="bg-background"
              onClick={browseArchive}
            >
              Browse archive
            </Button>
          ) : isImage && onPreview ? (
            <Button
              variant="outline"
              size="sm"
              className="bg-background"
              onClick={() => onPreview(file)}
            >
              View image
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="bg-background"
              asChild
            >
              <Link prefetch={false} href={urls.page}>
                View
              </Link>
            </Button>
          )}
          <div className="flex max-w-[calc(100%-1rem)] flex-wrap justify-center gap-1">
            {CARD_BUTTONS.map((id) => {
              const handler = offered(id)
              if (!handler) return null
              const { icon: Icon, button } = FILE_ACTIONS[id]
              const className =
                id === 'delete'
                  ? 'h-8 w-8 bg-background text-destructive hover:bg-danger/10 hover:text-destructive'
                  : 'h-8 w-8 bg-background'
              return handler.href ? (
                <Button
                  key={id}
                  variant="outline"
                  size="icon"
                  className={className}
                  asChild
                >
                  <a
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
                  variant="outline"
                  size="icon"
                  className={className}
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
              {CARD_MENU.map((group, index) => (
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
                        className={
                          id === 'delete'
                            ? 'text-destructive focus:bg-danger/10 focus:text-destructive'
                            : undefined
                        }
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
            <span
              className="ml-0.5 inline-flex items-center border-l border-border/60 pl-1.5"
              title={
                opened
                  ? 'Encrypted: the server cannot read this file'
                  : 'Plain: stored without encryption'
              }
              data-file-encryption={opened ? 'encrypted' : 'plain'}
            >
              {opened ? (
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              ) : (
                <ShieldOff className="h-3 w-3" aria-hidden="true" />
              )}
              <span className="sr-only">
                {opened ? 'Encrypted' : 'Plain file'}
              </span>
            </span>
          </span>
          <span
            className="inline-flex items-center gap-1 rounded-md border border-border/40 bg-background/90 px-2 py-1 backdrop-blur-sm"
            title={format(new Date(file.uploadedAt), 'PPP p')}
          >
            <Clock className="h-3 w-3" />
            {getRelativeTime(new Date(file.uploadedAt))}
          </span>
        </div>
        {file.expiresAt && !onSelect && permitted('expiration') && (
          <button
            type="button"
            onClick={() => setIsExpiryModalOpen(true)}
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
        {downloading && (
          <div
            role="status"
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/90"
          >
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
            <span className="text-sm font-medium">Decrypting…</span>
          </div>
        )}
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
      <div className="border-t border-border/40 p-3">
        <div className="flex items-center justify-between gap-2">
          <Link
            prefetch={false}
            href={urls.page}
            title={file.name}
            className="min-w-0 truncate rounded-sm text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          <div className="ml-auto flex shrink-0 items-center gap-3">
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

      {opened && (
        <EncryptedFilePasswordDialog
          file={file}
          opened={opened}
          open={isPasswordDialogOpen}
          onOpenChange={setIsPasswordDialogOpen}
          onUpdated={onUpdate}
        />
      )}
      <Dialog
        open={!opened && isPasswordDialogOpen}
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
