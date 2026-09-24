'use client'

import { useRef, useState } from 'react'

import type { FileFilterOptions } from '@/types/components/file'
import {
  AlertCircle,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Pin,
  Plus,
  Settings2,
} from 'lucide-react'
import { ZodError } from 'zod'

import { Button } from '@/components/ui/button'
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
import { Switch } from '@/components/ui/switch'

import {
  MAX_SAVED_VIEWS,
  MAX_SAVED_VIEW_NAME,
  SavedView,
  SavedViewFilters,
  filtersFromLibrary,
  savedViewMatches,
} from '@/lib/saved-views/schema'
import { cn } from '@/lib/utils'

import {
  SavedViewRequestError,
  savedViewRequest,
  useSavedViews,
} from '@/hooks/use-saved-views'
import { useToast } from '@/hooks/use-toast'

interface NamedItem {
  id: string
  name: string
}

function describeFilters(
  filters: SavedViewFilters | FileFilterOptions,
  folders: NamedItem[],
  tags: NamedItem[]
) {
  const sorting = {
    newest: 'Newest first',
    oldest: 'Oldest first',
    largest: 'Largest first',
    smallest: 'Smallest first',
    'most-viewed': 'Most viewed',
    'least-viewed': 'Least viewed',
    'most-downloaded': 'Most downloaded',
    'least-downloaded': 'Least downloaded',
  }
  return [
    filters.folder === 'unfiled'
      ? 'Unfiled'
      : filters.folder
        ? folders.find((folder) => folder.id === filters.folder)?.name ||
          'Unavailable folder'
        : 'All files',
    filters.tag === 'untagged'
      ? 'Untagged'
      : filters.tag
        ? tags.find((tag) => tag.id === filters.tag)?.name || 'Unavailable tag'
        : null,
    filters.search ? `Search: “${filters.search}”` : null,
    filters.types.length
      ? `${filters.types.length} file ${filters.types.length === 1 ? 'type' : 'types'}`
      : null,
    ...filters.visibility.map((visibility) =>
      visibility === 'hasPassword'
        ? 'Password protected'
        : visibility === 'public'
          ? 'Public'
          : 'Private'
    ),
    filters.dateFrom || filters.dateTo ? 'Upload date selected' : null,
    sorting[filters.sortBy],
    filters.groupBy !== 'none' ? `Grouped by ${filters.groupBy}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

export function SavedViews({
  filters,
  onRestore,
  folders,
  tags,
}: {
  filters: FileFilterOptions
  onRestore: (filters: SavedViewFilters) => void
  folders: NamedItem[]
  tags: NamedItem[]
}) {
  const { views, loading, error: loadError, reload } = useSavedViews()
  const { toast } = useToast()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SavedView | 'new' | null>(null)
  const [name, setName] = useState('')
  const [pinned, setPinned] = useState(true)
  const [useCurrentFilters, setUseCurrentFilters] = useState(false)
  const [draftFilters, setDraftFilters] = useState(filters)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const menuTrigger = useRef<HTMLButtonElement>(null)
  const saveTrigger = useRef<HTMLButtonElement>(null)
  const dialogTrigger = useRef<HTMLButtonElement | null>(null)
  const [applyingId, setApplyingId] = useState<string | null>(null)
  const existing = editing && editing !== 'new' ? editing : null
  const atLimit = views.length >= MAX_SAVED_VIEWS
  const matches = (view: SavedView) =>
    !view.unavailableReason && savedViewMatches(view.filters, filters)

  const startEditing = (view: SavedView | 'new') => {
    if (!dialogOpen) dialogTrigger.current = saveTrigger.current
    setEditing(view)
    setName(view === 'new' ? '' : view.name)
    setPinned(view === 'new' || view.pinned)
    setUseCurrentFilters(false)
    setDraftFilters(filters)
    setConfirmDelete(false)
    setError('')
    setDialogOpen(true)
  }

  const manage = () => {
    dialogTrigger.current = menuTrigger.current
    setEditing(null)
    setError('')
    setDialogOpen(true)
    void reload()
  }

  const setPending = (pending: boolean) => {
    busyRef.current = pending
    setBusy(pending)
  }

  const apply = async (view: SavedView) => {
    if (busyRef.current || view.unavailableReason) return
    setPending(true)
    setApplyingId(view.id)
    try {
      // Another tab may have edited the view or removed its folder/tag.
      const latest = await reload()
      if (latest.isError) throw new Error('Couldn’t load this view. Try again.')
      const current = latest.data?.find((item) => item.id === view.id)
      if (!current)
        throw new Error('This view was deleted. Choose another saved view.')
      if (current.unavailableReason) throw new Error(current.unavailableReason)
      onRestore(current.filters)
      setDialogOpen(false)
    } catch (cause) {
      toast({
        title: 'Couldn’t open saved view',
        description:
          cause instanceof Error ? cause.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setApplyingId(null)
      setPending(false)
    }
  }

  const handleError = async (cause: unknown) => {
    if (cause instanceof SavedViewRequestError && cause.status === 409) {
      const latest = await reload()
      if (!latest.isError && existing && cause.code === 'SAVED_VIEW_STALE') {
        const current = latest.data?.find((view) => view.id === existing.id)
        if (current) startEditing(current)
        else setEditing(null)
        setError(
          current
            ? 'This view changed in another tab. Its latest settings are loaded. Review them before saving again.'
            : 'This view was deleted in another tab. Your files are unchanged.'
        )
        return
      }
    }
    setError(
      cause instanceof ZodError
        ? cause.issues[0]?.message || 'These filters cannot be saved.'
        : cause instanceof Error
          ? cause.message
          : 'Couldn’t save your changes.'
    )
  }

  const save = async () => {
    if (busyRef.current || !name.trim()) return
    setPending(true)
    setError('')
    try {
      const nextFilters =
        !existing || useCurrentFilters
          ? filtersFromLibrary(draftFilters)
          : undefined
      await savedViewRequest<SavedView>(
        existing ? `/api/saved-views/${existing.id}` : '/api/saved-views',
        existing ? 'PATCH' : 'POST',
        existing
          ? {
              revision: existing.revision,
              name: name.trim(),
              pinned,
              ...(useCurrentFilters && { filters: nextFilters }),
            }
          : { name: name.trim(), pinned, filters: nextFilters }
      )
      await reload()
      setDialogOpen(false)
      setEditing(null)
      toast({ title: existing ? 'Saved view updated' : 'View saved' })
    } catch (cause) {
      await handleError(cause)
    } finally {
      setPending(false)
    }
  }

  const remove = async () => {
    if (busyRef.current || !existing) return
    setPending(true)
    setError('')
    try {
      await savedViewRequest(`/api/saved-views/${existing.id}`, 'DELETE', {
        revision: existing.revision,
      })
      await reload()
      setEditing(null)
      toast({
        title: 'Saved view deleted',
        description: 'Your files and current filters are unchanged.',
      })
    } catch (cause) {
      await handleError(cause)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mt-4 min-w-0 border-t border-border/50 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={menuTrigger}
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2"
              disabled={busy}
            >
              {loading || applyingId ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Bookmark className="h-4 w-4" />
              )}
              Saved views
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="max-h-[60vh] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto bg-popover"
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Private to your account
            </DropdownMenuLabel>
            {loading ? (
              <p
                className="px-2 py-3 text-sm text-muted-foreground"
                role="status"
              >
                Loading saved views…
              </p>
            ) : loadError ? (
              <DropdownMenuItem onSelect={() => void reload()}>
                Retry loading saved views
              </DropdownMenuItem>
            ) : views.length ? (
              views.map((view) => (
                <DropdownMenuItem
                  key={view.id}
                  disabled={!!view.unavailableReason}
                  onSelect={() => void apply(view)}
                  title={view.name}
                >
                  {matches(view) ? (
                    <Check />
                  ) : view.pinned ? (
                    <Pin />
                  ) : (
                    <Bookmark />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{view.name}</span>
                    {view.unavailableReason && (
                      <span className="block text-xs">
                        {view.unavailableReason}
                      </span>
                    )}
                  </span>
                </DropdownMenuItem>
              ))
            ) : (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                Save your favorite filters to return to them here.
              </p>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={manage}>
              <Settings2 />
              Manage views
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          ref={saveTrigger}
          variant="ghost"
          size="sm"
          className="ml-auto h-8 gap-1.5 px-2 text-muted-foreground"
          onClick={() => startEditing('new')}
          disabled={busy || loading || loadError || atLimit}
          title={
            atLimit
              ? `You can save up to ${MAX_SAVED_VIEWS} views. Delete one in Manage views to make room.`
              : 'Save the current folder, filters, sorting, and grouping'
          }
        >
          <Plus className="h-4 w-4" />
          Save view
        </Button>
      </div>
      {loadError && (
        <div
          className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"
          role="alert"
        >
          <span>Saved views couldn’t load.</span>
          <Button
            variant="link"
            size="sm"
            className="h-7 p-0 text-xs"
            onClick={() => void reload()}
          >
            Retry loading saved views
          </Button>
        </div>
      )}
      {!!views.some((view) => view.pinned) && !loadError && (
        <div
          role="group"
          aria-label="Pinned saved views"
          className="mt-2 flex max-w-full gap-2 overflow-x-auto pb-1"
        >
          {views
            .filter((view) => view.pinned)
            .map((view) => (
              <Button
                key={view.id}
                variant="outline"
                size="sm"
                aria-pressed={matches(view)}
                aria-label={`Open saved view: ${view.name}${view.unavailableReason ? `. ${view.unavailableReason}` : ''}`}
                title={view.unavailableReason || view.name}
                disabled={busy || !!view.unavailableReason}
                className={cn(
                  'h-8 max-w-48 shrink-0 gap-1.5 rounded-lg bg-background/70 text-xs',
                  matches(view) &&
                    'border-primary/40 bg-primary/10 text-primary'
                )}
                onClick={() => void apply(view)}
              >
                {view.unavailableReason ? (
                  <AlertCircle className="h-3 w-3 shrink-0" />
                ) : matches(view) ? (
                  <Check className="h-3 w-3 shrink-0" />
                ) : (
                  <Pin className="h-3 w-3 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{view.name}</span>
              </Button>
            ))}
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!busyRef.current) {
            setDialogOpen(open)
            if (!open) setEditing(null)
          }
        }}
      >
        <DialogContent
          className="max-h-[90dvh] max-w-lg overflow-y-auto"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const target = dialogTrigger.current
            if (target && !target.disabled) target.focus()
            else menuTrigger.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {editing
                ? existing
                  ? 'Edit saved view'
                  : 'Save view'
                : 'Saved views'}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? 'Keep a favorite way to browse your files. Views are private to your account and work across devices.'
                : `Save up to ${MAX_SAVED_VIEWS} views. New files appear whenever they match a view’s filters.`}
            </DialogDescription>
          </DialogHeader>

          {editing ? (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void save()
              }}
              className="space-y-5"
            >
              <div className="space-y-2">
                <Label htmlFor="saved-view-name">Name</Label>
                <Input
                  id="saved-view-name"
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Screenshot journal"
                  maxLength={MAX_SAVED_VIEW_NAME}
                  required
                  disabled={busy}
                />
              </div>
              <div className="rounded-xl border border-border/60">
                <div className="flex items-center justify-between gap-4 p-4">
                  <div>
                    <Label htmlFor="saved-view-pinned">Pin to Files</Label>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Show a shortcut above your library.
                    </p>
                  </div>
                  <Switch
                    id="saved-view-pinned"
                    checked={pinned}
                    onCheckedChange={setPinned}
                    disabled={busy}
                  />
                </div>
                {existing && (
                  <div className="flex items-center justify-between gap-4 border-t border-border/60 p-4">
                    <div>
                      <Label htmlFor="saved-view-replace">
                        Use current filters
                      </Label>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Replace this view’s folder, filters, sorting, and
                        grouping with the library behind this dialog.
                      </p>
                    </div>
                    <Switch
                      id="saved-view-replace"
                      checked={useCurrentFilters}
                      onCheckedChange={setUseCurrentFilters}
                      disabled={busy}
                    />
                  </div>
                )}
                <div className="border-t border-border/60 p-4">
                  <p className="text-xs font-medium">
                    {existing && !useCurrentFilters
                      ? 'Saved filters'
                      : 'Filters to save'}
                  </p>
                  <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
                    {describeFilters(
                      existing && !useCurrentFilters
                        ? existing.filters
                        : draftFilters,
                      folders,
                      tags
                    )}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    Opens page one and keeps your current page size.
                  </p>
                </div>
              </div>
              {existing?.unavailableReason && !useCurrentFilters && (
                <p className="text-sm text-muted-foreground" role="status">
                  {existing.unavailableReason} Choose the filters you want in
                  Files, then enable “Use current filters” here to repair the
                  view. You can also delete it.
                </p>
              )}
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              {confirmDelete && (
                <div className="rounded-lg border border-destructive/30 p-3 text-sm">
                  <p className="break-words">
                    Delete “{existing?.name}”? Your files and current filters
                    stay unchanged.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => void remove()}
                    >
                      Delete view
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setConfirmDelete(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              <DialogFooter className="border-t pt-4">
                {existing && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-muted-foreground sm:mr-auto"
                    disabled={busy}
                    onClick={() => setConfirmDelete(true)}
                  >
                    Delete view…
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setEditing(null)
                    setError('')
                  }}
                >
                  Back
                </Button>
                <Button
                  type="submit"
                  disabled={busy || !name.trim() || confirmDelete}
                >
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {existing ? 'Save changes' : 'Save view'}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <>
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              <div className="max-h-[50vh] overflow-y-auto">
                {loading ? (
                  <p
                    className="py-6 text-center text-sm text-muted-foreground"
                    role="status"
                  >
                    Loading saved views…
                  </p>
                ) : loadError ? (
                  <Button variant="outline" onClick={() => void reload()}>
                    Retry loading saved views
                  </Button>
                ) : views.length ? (
                  <div className="space-y-1">
                    {views.map((view) => (
                      <button
                        key={view.id}
                        type="button"
                        onClick={() => startEditing(view)}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {view.unavailableReason ? (
                          <AlertCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : view.pinned ? (
                          <Pin className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <Bookmark className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {view.name}
                          </span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {view.unavailableReason ||
                              (view.pinned
                                ? 'Pinned to Files'
                                : 'In Saved views')}
                            {matches(view) && ' · Current filters'}
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="py-6 text-center">
                    <Bookmark className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
                    <p className="text-sm font-medium">
                      A shortcut to the files you come back to.
                    </p>
                    <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
                      Set up your filters in Files, then save a view for next
                      time.
                    </p>
                  </div>
                )}
              </div>
              {atLimit && (
                <p className="text-xs text-muted-foreground">
                  You have {MAX_SAVED_VIEWS} saved views. Delete one to make
                  room for another.
                </p>
              )}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                  Done
                </Button>
                <Button
                  onClick={() => startEditing('new')}
                  disabled={loading || loadError || atLimit}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Save view
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
