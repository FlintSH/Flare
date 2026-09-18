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
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const matching = tags.filter((tag) =>
    tag.name.toLowerCase().includes(search.toLowerCase())
  )
  const update = async (
    tag: Pick<TagView, 'id' | 'name'>,
    action: 'add' | 'remove'
  ) => {
    await tagRequest('/api/files/tags', 'PATCH', {
      fileIds: files.map((file) => file.id),
      tagId: tag.id,
      action,
    })
    onChanged(
      files.map((file) => ({
        ...file,
        tags:
          action === 'remove'
            ? (file.tags ?? []).filter((item) => item.id !== tag.id)
            : [
                ...(file.tags ?? []).filter((item) => item.id !== tag.id),
                { id: tag.id, name: tag.name },
              ],
      }))
    )
    changed()
    setAnnouncement(`${tag.name} ${action === 'add' ? 'added' : 'removed'}.`)
  }
  const toggle = async (tag: TagView, all: boolean) => {
    if (busy) return
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
    if (busy || !search.trim()) return
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
        <div className="max-h-64 space-y-1 overflow-y-auto" aria-busy={busy}>
          {loading && (
            <p className="p-3 text-sm text-muted-foreground">Loading tags…</p>
          )}
          {loadError && (
            <Button variant="outline" onClick={() => void reload()}>
              Retry loading tags
            </Button>
          )}
          {matching.map((tag) => {
            const count = files.filter((file) =>
              file.tags?.some((item) => item.id === tag.id)
            ).length
            const all = count === files.length
            return (
              <button
                key={tag.id}
                type="button"
                role="checkbox"
                aria-checked={all ? true : count ? 'mixed' : false}
                disabled={busy}
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
                {files.length > 1 && count > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {count === files.length
                      ? 'All'
                      : `${count} of ${files.length}`}
                  </span>
                )}
              </button>
            )
          })}
          {!loading && !loadError && !tags.length && !search && (
            <div className="px-2 py-5 text-center text-sm text-muted-foreground">
              <Tag className="mx-auto mb-2 h-5 w-5" />
              Type a name to create your first tag.
            </div>
          )}
          {search.trim() &&
            !loadError &&
            !loading &&
            !tags.some(
              (tag) => tag.name.toLowerCase() === search.trim().toLowerCase()
            ) && (
              <Button
                variant="ghost"
                className="h-auto w-full justify-start gap-2 whitespace-normal py-3 text-left"
                disabled={busy}
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
              'Tags are visible only to you.'
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
