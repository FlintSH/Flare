'use client'

import { useState } from 'react'

import type { FileType } from '@/types/components/file'
import { Loader2, Plus, Tag } from 'lucide-react'

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
import { nameKey, normalizeName } from '@/lib/library/names'
import { TAG_NAME_MAX_LENGTH } from '@/lib/tags/schema'
import type { TagView } from '@/lib/tags/schema'
import { cn } from '@/lib/utils'
import { scrollFadeRef } from '@/lib/utils/scroll-fade'

import { useFileTagMemberships } from '@/hooks/use-file-tag-memberships'
import { useRequestLifetime } from '@/hooks/use-request-lifetime'
import { TAG_REQUEST_FAILED, useTags } from '@/hooks/use-tags'

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
  const lifetime = useRequestLifetime()
  const { tags, loading, error: loadError, reload, changed } = useTags()
  const memberships = useFileTagMemberships(files.map((file) => file.id))
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const currentFiles = memberships.files
  const ready = !!currentFiles && !loading && !loadError
  // Names compare as they are stored, so the list and Create agree.
  const searchKey = nameKey(normalizeName(search))
  const matching = tags.filter((tag) => nameKey(tag.name).includes(searchKey))
  const update = async (
    tag: Pick<TagView, 'id' | 'name'>,
    action: 'add' | 'remove'
  ) => {
    const { signal } = lifetime.current
    if (signal.aborted) return
    const updated = await memberships.update(tag, action)
    if (!updated || signal.aborted) return
    const freshTags = new Map(updated.map((file) => [file.id, file.tags]))
    onChanged(
      files.map((file) => ({
        ...file,
        tags: freshTags.get(file.id) ?? [],
      }))
    )
    void changed()
    setAnnouncement(`${tag.name} ${action === 'add' ? 'added' : 'removed'}.`)
  }
  const toggle = async (tag: TagView, all: boolean) => {
    const { signal } = lifetime.current
    if (signal.aborted) return
    if (busy || !ready) return
    setBusy(true)
    setError('')
    try {
      await update(tag, all ? 'remove' : 'add')
    } catch (error) {
      if (signal.aborted) return
      setError(error instanceof Error ? error.message : 'Couldn’t update tags.')
    } finally {
      if (!signal.aborted) setBusy(false)
    }
  }
  const create = async () => {
    const { signal } = lifetime.current
    if (signal.aborted) return
    if (busy || !ready || !search.trim()) return
    setBusy(true)
    setError('')
    try {
      const key = nameKey(normalizeName(search))
      const tag =
        tags.find((tag) => nameKey(tag.name) === key) ??
        (await apiRequest<TagView>('/api/tags', {
          body: { name: search.trim() },
          signal,
          fallback: TAG_REQUEST_FAILED,
        }))
      if (signal.aborted) return
      void reload()
      await update(tag, 'add')
      if (signal.aborted) return
      setSearch('')
    } catch (error) {
      if (signal.aborted) return
      setError(
        error instanceof Error ? error.message : 'Couldn’t create this tag.'
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
      {/* The same width as the other file dialogs. */}
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {files.length === 1 ? 'Edit tags' : `Tag ${files.length} files`}
          </DialogTitle>
          <DialogDescription className="break-words">
            {files.length === 1 ? (
              <>
                Add or remove tags for{' '}
                <span className="font-medium text-foreground">
                  {files[0].name}
                </span>
                .
              </>
            ) : (
              'Add or remove a tag across your selection. Other tags stay as they are.'
            )}
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
            maxLength={TAG_NAME_MAX_LENGTH}
            disabled={busy}
          />
        </form>
        <div
          ref={scrollFadeRef}
          className="scroll-fade max-h-64 space-y-1 overflow-y-auto overscroll-contain"
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
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60"
                >
                  {/* Drawn like the native checkboxes (app/globals.css): a
                      3:1 outline when off, and the same filled tick and dash. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded-[0.3rem] border border-control',
                      (all || count > 0) && 'border-primary bg-primary'
                    )}
                  >
                    {(all || count > 0) && (
                      <span
                        className={cn(
                          'h-2.5 w-2.5 bg-primary-foreground',
                          all
                            ? '[clip-path:polygon(14%_44%,0_65%,50%_100%,100%_16%,80%_0%,43%_62%)]'
                            : '[clip-path:inset(42%_12%)]'
                        )}
                      />
                    )}
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
            !tags.some((tag) => nameKey(tag.name) === searchKey) && (
              <Button
                variant="ghost"
                // On the rows' columns: the plus over the checkboxes.
                className="h-auto w-full justify-start gap-3 whitespace-normal rounded-lg px-2 py-2.5 text-left font-normal"
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
          <span className="order-1 flex flex-1 items-center text-xs text-muted-foreground sm:order-none">
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
