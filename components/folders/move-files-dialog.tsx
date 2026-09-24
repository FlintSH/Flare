'use client'

import { useState } from 'react'

import type { FileType } from '@/types/components/file'
import { Check, Folder, Inbox, Loader2, Plus } from 'lucide-react'

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

import { folderPath } from '@/lib/folders/navigation'
import type { FolderView } from '@/lib/folders/schema'
import { cn } from '@/lib/utils'

import { folderRequest, useFolders } from '@/hooks/use-folders'
import { useToast } from '@/hooks/use-toast'

export function MoveFilesDialog({
  files,
  onClose,
}: {
  files: FileType[]
  onClose: () => void
}) {
  const { folders, loading, error: loadError, reload, changed } = useFolders()
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
    if (busy || destination === undefined || destinationUnavailable) return
    setBusy(true)
    setError('')
    try {
      await folderRequest('/api/files/folders', 'POST', {
        fileIds: files.map((file) => file.id),
        folderId: destination,
      })
      changed()
      toast({
        title:
          files.length === 1 ? 'File moved' : `${files.length} files moved`,
        description: destination
          ? `Moved to ${folderPath(folders, destination)}.`
          : 'You can find these files in Unfiled.',
      })
      onClose()
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Couldn’t move these files.'
      )
    } finally {
      setBusy(false)
    }
  }
  const create = async () => {
    if (busy || !name.trim() || destinationUnavailable) return
    setBusy(true)
    setError('')
    try {
      const folder = await folderRequest<FolderView>('/api/folders', 'POST', {
        name: name.trim(),
        parentId: destination ?? null,
      })
      changed()
      await reload()
      setDestination(folder.id)
      setCreating(false)
      setName('')
      setSearch('')
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Couldn’t create this folder.'
      )
    } finally {
      setBusy(false)
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
            {files.length === 1
              ? files[0].name
              : 'Choose a folder for your selected files.'}{' '}
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
        <div
          className="max-h-64 space-y-1 overflow-y-auto"
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
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={destination === null}
                  onClick={() => selectDestination(null)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg p-3 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
                    destination === null && 'bg-primary/10 text-primary'
                  )}
                >
                  <Inbox className="h-4 w-4 shrink-0" />
                  <span className="flex-1">Unfiled</span>
                  {destination === null && <Check className="h-4 w-4" />}
                </button>
              )}
              {matching.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  disabled={busy}
                  aria-pressed={destination === folder.id}
                  onClick={() => selectDestination(folder.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg p-3 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
                    destination === folder.id && 'bg-primary/10 text-primary'
                  )}
                >
                  <Folder className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 break-words">
                    {folder.path}
                  </span>
                  {destination === folder.id && (
                    <Check className="h-4 w-4 shrink-0" />
                  )}
                </button>
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
        {creating ? (
          <form
            className="space-y-2 rounded-xl border p-3"
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
              maxLength={80}
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
                disabled={busy || destinationUnavailable || !name.trim()}
              >
                Create folder
              </Button>
            </div>
          </form>
        ) : (
          <Button
            variant="ghost"
            className="justify-start"
            disabled={busy || loading || loadError || destinationUnavailable}
            onClick={() => setCreating(true)}
          >
            <Plus className="mr-2 h-4 w-4" />
            New folder
          </Button>
        )}
        {selectedFolder?.shareToken && (
          <p className="rounded-lg bg-muted p-3 text-xs leading-5 text-muted-foreground">
            This folder has a share link. Public files you move here will appear
            on its shared page.
          </p>
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
