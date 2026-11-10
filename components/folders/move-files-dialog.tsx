'use client'

import { useState } from 'react'

import type { FileType } from '@/types/components/file'
import { Folder, Inbox, Link2, Loader2, Plus } from 'lucide-react'

import {
  FolderOption,
  folderListClassName,
} from '@/components/folders/folder-option'
import { Alert, AlertDescription } from '@/components/ui/alert'
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

import { apiRequest } from '@/lib/client/request'
import { displayFileName } from '@/lib/files/display-name'
import { folderRequestBody } from '@/lib/folders/client'
import { folderPath } from '@/lib/folders/navigation'
import { FOLDER_NAME_MAX_LENGTH, type FolderView } from '@/lib/folders/schema'
import { requestMaintenance } from '@/lib/library/browser-maintenance'
import { cn } from '@/lib/utils'
import { scrollFadeRef } from '@/lib/utils/scroll-fade'

import { FOLDER_REQUEST_FAILED, useFolders } from '@/hooks/use-folders'
import { useRequestLifetime } from '@/hooks/use-request-lifetime'
import { useToast } from '@/hooks/use-toast'

export function MoveFilesDialog({
  files,
  onClose,
}: {
  files: FileType[]
  onClose: () => void
}) {
  const lifetime = useRequestLifetime()
  const {
    folders,
    keys,
    keysLoading,
    loading,
    error: loadError,
    reload,
    changed,
  } = useFolders()
  const { toast } = useToast()
  const [destination, setDestination] = useState<string | null | undefined>(
    undefined
  )
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const selectedFolder = folders.find((folder) => folder.id === destination)
  const destinationUnavailable =
    !!destination && !loading && !loadError && !selectedFolder
  const selectDestination = (id: string | null) => {
    setDestination(id)
    setError('')
  }
  const matching = folders
    .map((folder) => ({ ...folder, path: folderPath(folders, folder.id) }))
    .filter((folder) =>
      folder.path.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => a.path.localeCompare(b.path))
  const move = async () => {
    const { signal } = lifetime.current
    if (signal.aborted) return
    if (busy || destination === undefined || destinationUnavailable) return
    setBusy(true)
    setError('')
    try {
      await apiRequest('/api/files/folders', {
        body: {
          fileIds: files.map((file) => file.id),
          folderId: destination,
        },
        signal,
        fallback: FOLDER_REQUEST_FAILED,
      })
      if (signal.aborted) return
      void changed()
      // A public encrypted file needs a stanza for the key of its new folder
      // (docs/e2ee-spec.md, section 9.4.4). This browser makes it now.
      requestMaintenance('folders')
      toast({
        title:
          files.length === 1 ? 'File moved' : `${files.length} files moved`,
        description: destination
          ? `Moved to ${folderPath(folders, destination)}.`
          : 'You can find these files in Unfiled.',
      })
      onClose()
    } catch (error) {
      if (signal.aborted) return
      setError(
        error instanceof Error ? error.message : 'Couldn’t move these files.'
      )
    } finally {
      if (!signal.aborted) setBusy(false)
    }
  }
  const create = async () => {
    const { signal } = lifetime.current
    if (signal.aborted) return
    if (busy || !name.trim() || destinationUnavailable) return
    setBusy(true)
    setError('')
    try {
      const folder = await apiRequest<FolderView>('/api/folders', {
        body: folderRequestBody({
          name,
          parentId: destination ?? null,
          folders,
          keys,
        }),
        signal,
        fallback: FOLDER_REQUEST_FAILED,
      })
      if (signal.aborted) return
      await changed()
      if (signal.aborted) return
      setDestination(folder.id)
      setCreating(false)
      setName('')
      setSearch('')
    } catch (error) {
      if (signal.aborted) return
      setError(
        error instanceof Error ? error.message : 'Couldn’t create this folder.'
      )
    } finally {
      if (!signal.aborted) setBusy(false)
    }
  }
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
            {files.length === 1 ? 'Move file' : `Move ${files.length} files`}
          </DialogTitle>
          <DialogDescription className="break-words">
            {files.length === 1 ? (
              <>
                Choose a folder for{' '}
                <span className="font-medium text-foreground">
                  {displayFileName(files[0])}
                </span>
                .
              </>
            ) : (
              'Choose a folder for your selected files.'
            )}{' '}
            Links, tags, and file privacy stay the same.
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Find a folder"
          placeholder="Find a folder…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          disabled={busy}
        />
        {/* The same list as the archive destination picker; its height
            leaves half a row showing when it scrolls. */}
        <div className="rounded-xl border p-1">
          <div
            ref={scrollFadeRef}
            className={cn(folderListClassName, 'max-h-[16.5rem]')}
            role="group"
            aria-label="Destination folder"
            aria-busy={loading || busy}
          >
            {loading ? (
              <p className="p-3 text-sm text-muted-foreground">
                Loading folders…
              </p>
            ) : loadError ? (
              <Button variant="outline" onClick={() => void reload()}>
                Retry loading folders
              </Button>
            ) : (
              <>
                {'unfiled'.includes(search.toLowerCase()) && (
                  <FolderOption
                    icon={<Inbox aria-hidden="true" />}
                    label="Unfiled"
                    selected={destination === null}
                    disabled={busy}
                    onSelect={() => selectDestination(null)}
                  />
                )}
                {matching.map((folder) => (
                  <FolderOption
                    key={folder.id}
                    icon={<Folder aria-hidden="true" />}
                    label={folder.path}
                    selected={destination === folder.id}
                    disabled={busy}
                    onSelect={() => selectDestination(folder.id)}
                  />
                ))}
                {search &&
                  !matching.length &&
                  !'unfiled'.includes(search.toLowerCase()) && (
                    <p className="p-3 text-sm text-muted-foreground">
                      No matching folders.
                    </p>
                  )}
              </>
            )}
          </div>
        </div>
        {creating ? (
          <form
            className="space-y-2 rounded-xl border bg-muted/30 p-3"
            onSubmit={(event) => {
              event.preventDefault()
              void create()
            }}
          >
            <p className="break-words text-xs text-muted-foreground">
              {destination
                ? `New folder inside ${folderPath(folders, destination)}`
                : 'New top-level folder'}
            </p>
            <Input
              autoFocus
              aria-label="New folder name"
              placeholder="Folder name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={FOLDER_NAME_MAX_LENGTH}
              disabled={busy}
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setCreating(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={
                  busy || keysLoading || destinationUnavailable || !name.trim()
                }
              >
                Create folder
              </Button>
            </div>
          </form>
        ) : (
          // An action under the list, not one more destination row.
          <Button
            variant="outline"
            size="sm"
            disabled={busy || loading || loadError || destinationUnavailable}
            onClick={() => setCreating(true)}
          >
            <Plus aria-hidden="true" />
            New folder
          </Button>
        )}
        {selectedFolder?.shareToken && (
          <Alert variant="info" role="status">
            <Link2 aria-hidden="true" />
            <AlertDescription>
              This folder has a share link. Public files you move here will
              appear on its shared page.
            </AlertDescription>
          </Alert>
        )}
        {destinationUnavailable && (
          <p role="alert" className="text-sm text-destructive">
            The selected folder is no longer available. Choose another
            destination.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              busy ||
              loading ||
              loadError ||
              destination === undefined ||
              destinationUnavailable ||
              creating
            }
            onClick={() => void move()}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Move here
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
