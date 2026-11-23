'use client'

import { type ReactNode, useState } from 'react'

import { FileType } from '@/types/components/file'
import { Loader2 } from 'lucide-react'

import {
  FILE_ACTIONS,
  type FileActionId,
  fileActionAllowed,
} from '@/components/dashboard/file-card/actions'
import { ArchiveBrowserDialog } from '@/components/dashboard/library-dialogs'
import { OcrDialog } from '@/components/shared/ocr-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { RefusedRequest, apiRequest } from '@/lib/client/request'
import { fileUrls } from '@/lib/files/urls'

import { useOcr } from '@/hooks/use-ocr'
import { usePermissions } from '@/hooks/use-permissions'
import { useRequestLifetime } from '@/hooks/use-request-lifetime'
import { useToast } from '@/hooks/use-toast'

const TRY_AGAIN = 'Please try again.'
const failure = (error: unknown) =>
  error instanceof RefusedRequest ? error.message : TRY_AGAIN

/** What an action does where the file is shown; one without an entry isn't offered. */
export interface FileActionHandler {
  run?: () => void
  href?: string
  download?: string
  disabled?: boolean
}

export interface FileActionsOptions {
  /** After the file is deleted. */
  onDelete?: (id: string) => void
  onBrowseArchive?: () => void
  onEditTags?: () => void
  /** Offers text extraction (and its dialog): the sheet does, cards don't. */
  ocr?: boolean
}

/**
 * The quick actions on one file, shared by its card's menu and its sheet:
 * the same handlers, permissions and dialogs, so an action behaves the same
 * in both. Everything else about a file is changed in its sheet. The caller
 * renders `dialogs` once beside the controls.
 */
export function useFileActions(
  file: FileType,
  { onDelete, onBrowseArchive, onEditTags, ocr: offersOcr }: FileActionsOptions
) {
  const { user } = usePermissions()
  const { toast } = useToast()
  const lifetime = useRequestLifetime()
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const urls = fileUrls(file)
  const ocr = useOcr(urls.ocr)

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
    if (deleting || signal.aborted) return
    setDeleting(true)
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
      if (!signal.aborted) setDeleting(false)
    }
  }

  const isImage = file.mimeType.startsWith('image/')
  const permitted = (id: FileActionId) => fileActionAllowed(user, id)
  const browseArchive = permitted('browseArchive') ? onBrowseArchive : undefined
  // What each action does here; one without an entry isn't offered.
  const handlers: Partial<Record<FileActionId, FileActionHandler>> = {
    ...(browseArchive && { browseArchive: { run: browseArchive } }),
    copyLink: { run: () => void handleCopyLink() },
    download: { href: urls.download, download: file.name },
    ...(onEditTags && { editTags: { run: onEditTags } }),
    ...(offersOcr &&
      isImage && {
        ocr: { run: () => void ocr.extract(), disabled: ocr.loading },
      }),
    delete: { run: () => setIsDeleteDialogOpen(true) },
  }
  const offered = (id: FileActionId) =>
    permitted(id) ? handlers[id] : undefined
  // The tag count opens the file's tags only where the role can edit them.
  const editTags = offered('editTags')
  // The archive browser is fetched on first use. That starts when the
  // pointer or the keyboard reaches a card, so it's usually here in time.
  const preloadDialogs = () => {
    if (browseArchive) ArchiveBrowserDialog.preload()
  }

  const menuLabel = (id: FileActionId) => {
    const { menu } = FILE_ACTIONS[id] as {
      menu?:
        string | ((state: { hasPassword: boolean; busy: boolean }) => string)
    }
    return typeof menu === 'function'
      ? menu({ hasPassword: file.hasPassword, busy: ocr.loading })
      : (menu ?? '')
  }

  const dialogs: ReactNode = (
    <>
      <Dialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          if (!deleting) setIsDeleteDialogOpen(open)
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
              disabled={deleting}
              onClick={() => setIsDeleteDialogOpen(false)}
            >
              Keep file
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={handleDelete}
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete file
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {offersOcr && <OcrDialog {...ocr.dialog} filename={file.name} />}
    </>
  )

  return {
    urls,
    editTags,
    offered,
    permitted,
    menuLabel,
    ocrBusy: ocr.loading,
    preloadDialogs,
    dialogs,
  }
}
