'use client'

import { useState } from 'react'

import type { FileType } from '@/types/components/file'
import { Check, Loader2, Minus, Plus, Tag } from 'lucide-react'

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

import { cn } from '@/lib/utils'

import { useFileTagMemberships } from '@/hooks/use-file-tag-memberships'
import { TagView, tagRequest, useTags } from '@/hooks/use-tags'

/** Each change is additive/removing, so bulk edits preserve every other tag. */
export function FileTagsDialog({
  files,
  onClose,
  onChanged,
}: {
  files: FileType[]
  onClose: () => void
  onChanged: (files: FileType[]) => void
}) {
  const { tags, loading, error: loadError, reload, changed } = useTags()
  const memberships = useFileTagMemberships(files.map((file) => file.id))
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const currentFiles = memberships.files
  const ready = !!currentFiles && !loading && !loadError
  const matching = tags.filter((tag) =>
    tag.name.toLowerCase().includes(search.toLowerCase())
  )
  const update = async (
    tag: Pick<TagView, 'id' | 'name'>,
    action: 'add' | 'remove'
  ) => {
    const updated = await memberships.update(tag, action)
    if (!updated) return
    const freshTags = new Map(updated.map((file) => [file.id, file.tags]))
    onChanged(
      files.map((file) => ({
        ...file,
        tags: freshTags.get(file.id) ?? [],
      }))
    )
    changed()
    setAnnouncement(`${tag.name} ${action === 'add' ? 'added' : 'removed'}.`)
  }
  const toggle = async (tag: TagView, all: boolean) => {
    if (busy || !ready) return
    setBusy(true)
    setError('')
    try {
      await update(tag, all ? 'remove' : 'add')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Couldn’t update tags.')
    } finally {
      setBusy(false)
    }
  }
  const create = async () => {
    if (busy || !ready || !search.trim()) return
    setBusy(true)
    setError('')
    try {
      const normalized = search
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase()
      const tag =
        tags.find((tag) => tag.name.toLowerCase() === normalized) ??
        (await tagRequest<TagView>('/api/tags', 'POST', {
          name: search.trim(),
        }))
      changed()
      await update(tag, 'add')
      setSearch('')
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Couldn’t create this tag.'
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
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {files.length === 1 ? 'Edit tags' : `Tag ${files.length} files`}
          </DialogTitle>
          <DialogDescription className="break-words">
            {files.length === 1
              ? files[0].name
              : 'Add or remove a tag across your selection. Other tags stay as they are.'}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void create()
          }}
        >
          <Input
            autoFocus
            aria-label="Find or create a tag"
            placeholder="Find or create a tag…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            maxLength={40}
            disabled={busy}
          />
        </form>
        <div
          className="max-h-64 space-y-1 overflow-y-auto"
          aria-busy={busy || loading || memberships.loading}
        >
          {memberships.loading && (
            <p role="status" className="p-3 text-sm text-muted-foreground">
              Loading file tags…
            </p>
          )}
          {memberships.error && (
            <div className="space-y-2 p-2">
              <p role="alert" className="text-sm text-destructive">
                {memberships.error}
              </p>
              <Button variant="outline" onClick={memberships.reload}>
                Retry loading file tags
              </Button>
            </div>
          )}
          {loading && (
            <p className="p-3 text-sm text-muted-foreground">Loading tags…</p>
          )}
          {loadError && (
            <Button variant="outline" onClick={() => void reload()}>
              Retry loading tags
            </Button>
          )}
          {currentFiles &&
            matching.map((tag) => {
              const count = currentFiles.filter((file) =>
                file.tags?.some((item) => item.id === tag.id)
              ).length
              const all = count === currentFiles.length
              return (
                <button
                  key={tag.id}
                  type="button"
                  role="checkbox"
                  aria-checked={all ? true : count ? 'mixed' : false}
                  disabled={busy || !ready}
                  onClick={() => void toggle(tag, all)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      (all || count > 0) &&
                        'border-primary bg-primary text-primary-foreground'
                    )}
                  >
                    {all ? (
                      <Check className="h-3 w-3" />
                    ) : count > 0 ? (
                      <Minus className="h-3 w-3" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                  {currentFiles.length > 1 && count > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {all ? 'All' : `${count} of ${currentFiles.length}`}
                    </span>
                  )}
                </button>
              )
            })}
          {ready && !tags.length && !search && (
            <div className="px-2 py-5 text-center text-sm text-muted-foreground">
              <Tag className="mx-auto mb-2 h-5 w-5" />
              Type a name to create your first tag.
            </div>
          )}
          {search.trim() &&
            ready &&
            !tags.some(
              (tag) => tag.name.toLowerCase() === search.trim().toLowerCase()
            ) && (
              <Button
                variant="ghost"
                className="h-auto w-full justify-start gap-2 whitespace-normal py-3 text-left"
                disabled={busy || !ready}
                onClick={() => void create()}
              >
                <Plus className="h-4 w-4 shrink-0" />
                <span className="min-w-0 break-words">
                  Create “{search.trim()}”
                </span>
              </Button>
            )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <p className="sr-only" role="status">
          {announcement}
        </p>
        <DialogFooter>
          <span className="flex flex-1 items-center text-xs text-muted-foreground">
            {busy ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                Saving…
              </>
            ) : (
              'Tags are not shown on public file pages.'
            )}
          </span>
          <Button onClick={onClose} disabled={busy}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
