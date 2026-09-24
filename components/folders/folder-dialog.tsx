'use client'

import { useEffect, useState } from 'react'

import { Check, Copy, ExternalLink, Link2, Loader2, Lock } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import type { FolderView } from '@/lib/folders/schema'

import { folderRequest, useFolders } from '@/hooks/use-folders'
import { useToast } from '@/hooks/use-toast'

export type FolderAction =
  | { kind: 'create'; parentId: string | null }
  | { kind: 'rename' | 'delete' | 'share'; folder: FolderView }

export function FolderDialog({
  action,
  onClose,
  onCreated,
  onDeleted,
}: {
  action: FolderAction
  onClose: () => void
  onCreated: (folder: FolderView) => void
  onDeleted: (folder: FolderView) => void
}) {
  const { folders, loading, error: loadError, changed, reload } = useFolders()
  const snapshot = action.kind === 'create' ? null : action.folder
  const current = folders.find((folder) => folder.id === snapshot?.id)
  const existing = current ?? snapshot
  const unavailable =
    !loading &&
    !loadError &&
    (action.kind === 'create'
      ? !!action.parentId &&
        !folders.some((folder) => folder.id === action.parentId)
      : !current)
  const { toast } = useToast()
  const [name, setName] = useState(existing?.name ?? '')
  const [token, setToken] = useState(existing?.shareToken ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  // A focus refresh can revoke or rotate the link while this dialog remains open.
  useEffect(() => {
    if (!loading && !loadError) {
      setToken(current?.shareToken ?? null)
      setCopied(false)
    }
  }, [current?.shareToken, loading, loadError])
  const shareUrl =
    token && typeof window !== 'undefined'
      ? `${window.location.origin}/s/folders/${token}`
      : ''
  const run = async (operation: () => Promise<void>) => {
    if (busy || unavailable) return
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Couldn’t update this folder.'
      )
    } finally {
      setBusy(false)
    }
  }
  const save = () =>
    run(async () => {
      const folder = await folderRequest<FolderView>(
        existing ? `/api/folders/${existing.id}` : '/api/folders',
        existing ? 'PATCH' : 'POST',
        {
          name: name.trim(),
          ...(action.kind === 'create' && { parentId: action.parentId }),
        }
      )
      changed()
      toast({ title: existing ? 'Folder renamed' : 'Folder created' })
      if (!existing) {
        await reload()
        onCreated(folder)
      }
      onClose()
    })
  const remove = () =>
    run(async () => {
      if (!existing) return
      await folderRequest(`/api/folders/${existing.id}`, 'DELETE')
      changed()
      onDeleted(existing)
      toast({
        title: 'Folder removed',
        description: 'Your files have been kept.',
      })
      onClose()
    })
  const share = (sharing: boolean) =>
    run(async () => {
      if (!existing) return
      const folder = await folderRequest<FolderView>(
        `/api/folders/${existing.id}`,
        'PATCH',
        { sharing }
      )
      setToken(folder.shareToken)
      setCopied(false)
      changed()
      toast({ title: sharing ? 'Folder link created' : 'Folder link disabled' })
    })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {action.kind === 'create'
              ? 'New folder'
              : action.kind === 'rename'
                ? 'Rename folder'
                : action.kind === 'delete'
                  ? 'Remove this folder?'
                  : 'Share folder'}
          </DialogTitle>
          <DialogDescription className="break-words">
            {action.kind === 'create'
              ? 'Give a group of files a home. You can still find everything in All files.'
              : action.kind === 'rename'
                ? 'Choose a name that makes this folder easy to find.'
                : action.kind === 'delete'
                  ? `“${existing?.name}” will be removed. Its files and subfolders move ${existing?.parentId ? 'up to the parent folder' : 'out of this folder'}. No files are deleted. Its folder link stops working.`
                  : `Share the public files directly inside “${existing?.name}” with one link.`}
          </DialogDescription>
        </DialogHeader>
        {unavailable && (
          <p role="alert" className="text-sm text-destructive">
            {action.kind === 'create'
              ? 'The parent folder is no longer available. Close this dialog and choose another folder.'
              : 'This folder is no longer available. Close this dialog to return to your files.'}
          </p>
        )}
        {(action.kind === 'create' || action.kind === 'rename') && (
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="folder-name">Folder name</Label>
              <Input
                id="folder-name"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                disabled={busy}
                placeholder="e.g. Marketing assets"
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={busy || unavailable || !name.trim()}
              >
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {existing ? 'Save name' : 'Create folder'}
              </Button>
            </DialogFooter>
          </form>
        )}
        {action.kind === 'delete' && (
          <>
            {folders.find((folder) => folder.id === existing?.parentId)
              ?.shareToken && (
              <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                The parent folder has a share link. Public files moved into it
                will appear on its shared page.
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={onClose}>
                Keep folder
              </Button>
              <Button
                variant="destructive"
                disabled={busy || unavailable}
                onClick={() => void remove()}
              >
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Remove folder, keep files
              </Button>
            </DialogFooter>
          </>
        )}
        {action.kind === 'share' && (
          <div className="space-y-5">
            <div className="rounded-xl border bg-muted/30 p-4">
              <p className="flex items-center gap-2 text-sm font-medium">
                {token ? (
                  <Link2 className="h-4 w-4 text-primary" />
                ) : (
                  <Lock className="h-4 w-4" />
                )}
                {token
                  ? 'Anyone with the link'
                  : 'Only you can browse this folder'}
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Private files and subfolders stay hidden. Password-protected
                files still need their password. Adding public files to this
                folder adds them to the shared page.
              </p>
            </div>
            {token && (
              <div className="space-y-2">
                <Label htmlFor="folder-share-link">Folder link</Label>
                <div className="flex gap-2">
                  <Input
                    id="folder-share-link"
                    value={shareUrl}
                    readOnly
                    onFocus={(event) => event.target.select()}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Copy folder link"
                    disabled={busy || unavailable}
                    onClick={() =>
                      void run(async () => {
                        await navigator.clipboard.writeText(shareUrl)
                        setCopied(true)
                      })
                    }
                  >
                    {copied ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <a
                  className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
                  href={shareUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open shared folder
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                {copied && (
                  <p role="status" className="text-xs text-muted-foreground">
                    Link copied
                  </p>
                )}
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={onClose}>
                Done
              </Button>
              <Button
                variant={token ? 'destructive' : 'default'}
                disabled={busy || unavailable}
                onClick={() => void share(!token)}
              >
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {token ? 'Disable link' : 'Create share link'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
