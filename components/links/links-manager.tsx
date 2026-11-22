'use client'

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { format, isSameYear } from 'date-fns'
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  Copy,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'
import { z } from 'zod'

import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
import { Skeleton } from '@/components/ui/skeleton'

import { RefusedRequest, apiRequest } from '@/lib/client/request'
import {
  SHORT_CODE_MAX_LENGTH,
  type ShortLink,
  shortLinkInputSchema,
  shortLinkUpdateSchema,
  shortLinkUrl,
} from '@/lib/links/schema'
import { cn } from '@/lib/utils'

import { useHydrated } from '@/hooks/use-hydrated'
import { usePermissions } from '@/hooks/use-permissions'
import { useToast } from '@/hooks/use-toast'

/** A destination as people read it: without `https://`, which says nothing. */
const readable = (url: string) => url.replace(/^https:\/\//i, '')

const problem = (failure: unknown, fallback: string) =>
  failure instanceof z.ZodError
    ? (failure.issues[0]?.message ?? fallback)
    : failure instanceof Error
      ? failure.message
      : fallback

/**
 * The Links page: shorten a link, optionally under an ending of your own,
 * and find, copy, redirect or delete the ones you have.
 */
export function LinksManager() {
  const { can } = usePermissions()
  const canCreate = can('links.create')
  const canDelete = can('links.delete')
  // A new destination retires the old redirect, so it needs both.
  const canEdit = canCreate && canDelete
  const hydrated = useHydrated()
  const origin = hydrated ? window.location.origin : ''
  const { toast } = useToast()

  const [links, setLinks] = useState<ShortLink[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const requestVersion = useRef(0)
  const [query, setQuery] = useState('')
  const [fresh, setFresh] = useState<string>()
  const [copied, setCopied] = useState<string>()
  const [editing, setEditing] = useState<ShortLink | null>(null)
  const [deleting, setDeleting] = useState<ShortLink | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const version = ++requestVersion.current
      try {
        const data = await apiRequest<{ urls?: ShortLink[] }>('/api/urls', {
          signal,
        })
        if (signal?.aborted || version !== requestVersion.current) return
        setLinks(data.urls ?? [])
        setLoadError('')
      } catch (failure) {
        if (signal?.aborted || version !== requestVersion.current) return
        setLoadError(
          failure instanceof RefusedRequest || !(failure instanceof Error)
            ? 'Could not load your links. Try again.'
            : failure.message
        )
      } finally {
        if (!signal?.aborted && version === requestVersion.current)
          setLoading(false)
      }
    },
    [setLinks]
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  // After a change, read the list again. A read already under way started
  // before the change and would put the old list back, so its answer is
  // dropped (see `requestVersion`) in favour of this one.
  const reconcile = () => void load()

  // A new link is marked for a moment, then looks like the rest.
  useEffect(() => {
    if (!fresh) return
    const timer = setTimeout(() => setFresh(undefined), 2400)
    return () => clearTimeout(timer)
  }, [fresh])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return links
    return links.filter(
      (link) =>
        link.shortCode.toLowerCase().includes(needle) ||
        link.targetUrl.toLowerCase().includes(needle)
    )
  }, [links, query])

  const copy = async (link: ShortLink) => {
    try {
      await navigator.clipboard.writeText(
        shortLinkUrl(link.shortCode, window.location.origin)
      )
      setCopied(link.id)
      setTimeout(
        () =>
          setCopied((current) => (current === link.id ? undefined : current)),
        2000
      )
      toast({ title: 'Link copied' })
    } catch {
      toast({
        title: 'Could not copy the link',
        description: 'Press and hold or right-click the link to copy it.',
        variant: 'destructive',
      })
    }
  }

  return (
    <>
      {/* Title and search share a row; on phones the create bar comes
          before the search, since making a link is why most people come. */}
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
        <h1
          id="links-heading"
          className="order-1 text-2xl font-semibold tracking-tight"
        >
          Links
        </h1>
        {links.length > 0 && (
          <div className="relative order-3 w-full sm:order-2 sm:-my-0.5 sm:w-64">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              aria-label="Search links"
              placeholder="Search links"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 pl-9"
            />
          </div>
        )}
        {canCreate && (
          <div className="order-2 w-full sm:order-3 sm:mt-2">
            <CreateLinkForm
              origin={origin}
              onCreated={(link) => {
                setLinks((current) => [link, ...current])
                // The new link always shows, whatever was searched for.
                setQuery('')
                setFresh(link.id)
                setAnnouncement(
                  `Created ${shortLinkUrl(link.shortCode, origin)}`
                )
                reconcile()
              }}
            />
          </div>
        )}
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <div className="mt-6">
        {loading ? (
          <div
            role="status"
            aria-label="Loading links"
            className="divide-y divide-border/70 rounded-xl border"
          >
            {[0, 1, 2].map((row) => (
              <div key={row} className="space-y-2 p-4">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        ) : loadError ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>{loadError}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setLoading(true)
                  void load()
                }}
              >
                <RefreshCw aria-hidden="true" />
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : links.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            No links yet.
          </p>
        ) : shown.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            No links match “{query.trim()}”.
          </p>
        ) : (
          <ul
            aria-labelledby="links-heading"
            className="divide-y divide-border/70 overflow-hidden rounded-xl border"
          >
            {shown.map((link) => (
              <LinkRow
                key={link.id}
                link={link}
                origin={origin}
                fresh={fresh === link.id}
                copied={copied === link.id}
                canEdit={canEdit}
                canDelete={canDelete}
                onCopy={() => void copy(link)}
                onEdit={() => setEditing(link)}
                onDelete={() => setDeleting(link)}
              />
            ))}
          </ul>
        )}
      </div>

      <EditLinkDialog
        link={editing}
        origin={origin}
        onClose={() => setEditing(null)}
        onSaved={(saved) => {
          setLinks((current) =>
            current.map((link) => (link.id === saved.id ? saved : link))
          )
          setEditing(null)
          reconcile()
          toast({ title: 'Link updated' })
        }}
      />
      <DeleteLinkDialog
        link={deleting}
        origin={origin}
        onClose={() => setDeleting(null)}
        onDeleted={(gone) => {
          setLinks((current) => current.filter((link) => link.id !== gone.id))
          setDeleting(null)
          reconcile()
          toast({ title: 'Link deleted' })
        }}
      />
    </>
  )
}

function CreateLinkForm({
  origin,
  onCreated,
}: {
  origin: string
  onCreated: (link: ShortLink) => void
}) {
  const [url, setUrl] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const host = origin.replace(/^https?:\/\//, '')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError('')
    let body: z.infer<typeof shortLinkInputSchema>
    try {
      body = shortLinkInputSchema.parse({ url: url.trim(), code })
    } catch (failure) {
      setError(problem(failure, 'Check the link and try again.'))
      return
    }
    setBusy(true)
    try {
      const link = await apiRequest<ShortLink>('/api/urls', {
        body,
        fallback: 'Could not create the link. Try again.',
      })
      setUrl('')
      setCode('')
      onCreated(link)
    } catch (failure) {
      setError(problem(failure, 'Could not create the link. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-2">
      <div className="flex flex-col gap-2 lg:flex-row">
        <Input
          type="url"
          inputMode="url"
          aria-label="Link to shorten"
          placeholder="Paste a long link"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          disabled={busy}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'link-error' : undefined}
          className="h-10 min-w-0 lg:flex-1"
        />
        <div className="flex gap-2">
          {/* The link to be made: the instance, then an ending of their own. */}
          <div className="flex h-10 min-w-0 flex-1 items-center overflow-hidden rounded-md border border-control bg-transparent text-sm shadow-sm focus-within:ring-1 focus-within:ring-ring lg:w-96 lg:flex-none">
            {/* Only the host gives way on a narrow screen; /u/ always shows. */}
            <span
              className="flex min-w-0 max-w-[60%] shrink-0 pl-3 font-mono text-muted-foreground"
              title={`${host}/u/`}
            >
              <span className="hidden truncate sm:inline">{host}</span>
              <span className="shrink-0">/u/</span>
            </span>
            <input
              aria-label="Custom ending (optional)"
              placeholder="random"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              disabled={busy}
              maxLength={SHORT_CODE_MAX_LENGTH}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              className="h-full min-w-0 flex-1 bg-transparent pr-3 font-mono outline-none placeholder:text-muted-foreground/70"
            />
          </div>
          <Button type="submit" disabled={busy || !url.trim()} className="h-10">
            {busy && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            Shorten
          </Button>
        </div>
      </div>
      {error && (
        <p id="link-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}

function LinkRow({
  link,
  origin,
  fresh,
  copied,
  canEdit,
  canDelete,
  onCopy,
  onEdit,
  onDelete,
}: {
  link: ShortLink
  origin: string
  fresh: boolean
  copied: boolean
  canEdit: boolean
  canDelete: boolean
  onCopy: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const created = new Date(link.createdAt)
  const host = origin.replace(/^https?:\/\//, '')
  return (
    <li
      className={cn(
        'flex items-center gap-3 px-4 py-3 transition-colors duration-700 motion-reduce:transition-none',
        fresh && 'bg-primary/10'
      )}
    >
      <div className="min-w-0 flex-1">
        <a
          href={shortLinkUrl(link.shortCode)}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate rounded-sm font-mono text-sm outline-none underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="hidden text-muted-foreground sm:inline">{host}</span>
          <span className="font-medium">/u/{link.shortCode}</span>
        </a>
        <a
          href={link.targetUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={link.targetUrl}
          className="mt-0.5 block truncate rounded-sm text-xs text-muted-foreground outline-none underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="sr-only">Leads to </span>
          {readable(link.targetUrl)}
        </a>
        <p className="mt-1 text-xs text-muted-foreground sm:hidden">
          {clicks(link.clicks)} · {when(created)}
        </p>
      </div>
      <p className="hidden w-24 shrink-0 text-right text-sm tabular-nums text-muted-foreground sm:block">
        {clicks(link.clicks)}
      </p>
      <p className="hidden w-20 shrink-0 text-right text-sm text-muted-foreground md:block">
        <time dateTime={link.createdAt}>{when(created)}</time>
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        aria-label={`Copy ${shortLinkUrl(link.shortCode, origin)}`}
        onClick={onCopy}
      >
        {copied ? (
          <Check className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Copy className="h-4 w-4" aria-hidden="true" />
        )}
        <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
      </Button>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label={`More for /u/${link.shortCode}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {/* The whole destination, readable on touch and with a keyboard. */}
          <DropdownMenuLabel className="line-clamp-3 break-all font-mono text-xs font-normal text-muted-foreground">
            {link.targetUrl}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a href={link.targetUrl} target="_blank" rel="noopener noreferrer">
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              Open destination
            </a>
          </DropdownMenuItem>
          {canEdit && (
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Change destination
            </DropdownMenuItem>
          )}
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={onDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

const clicks = (count: number) =>
  `${count.toLocaleString()} ${count === 1 ? 'click' : 'clicks'}`

const when = (date: Date) =>
  format(date, isSameYear(date, new Date()) ? 'MMM d' : 'MMM d, yyyy')

function EditLinkDialog({
  link,
  origin,
  onClose,
  onSaved,
}: {
  link: ShortLink | null
  origin: string
  onClose: () => void
  onSaved: (link: ShortLink) => void
}) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!link) return
    setUrl(link.targetUrl)
    setError('')
    setBusy(false)
  }, [link])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!link || busy) return
    setError('')
    let body: z.infer<typeof shortLinkUpdateSchema>
    try {
      body = shortLinkUpdateSchema.parse({ url: url.trim() })
    } catch (failure) {
      setError(problem(failure, 'Check the link and try again.'))
      return
    }
    setBusy(true)
    try {
      onSaved(
        await apiRequest<ShortLink>(`/api/urls/${link.id}`, {
          method: 'PATCH',
          body,
          fallback: 'Could not save. The link still leads where it did.',
        })
      )
    } catch (failure) {
      setError(
        problem(failure, 'Could not save. The link still leads where it did.')
      )
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={Boolean(link)}
      onOpenChange={(open) => !open && !busy && onClose()}
    >
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} noValidate className="space-y-5">
          <DialogHeader>
            <DialogTitle>Change destination</DialogTitle>
            <DialogDescription>
              Everyone who opens{' '}
              <span className="break-all font-mono text-foreground">
                {link && shortLinkUrl(link.shortCode, origin)}
              </span>{' '}
              will go to the new address. Its clicks are kept.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="link-destination">Destination</Label>
            <Input
              id="link-destination"
              type="url"
              inputMode="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              disabled={busy}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'link-destination-error' : undefined}
              className="font-mono text-sm"
            />
            {error && (
              <p
                id="link-destination-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || !url.trim() || url.trim() === link?.targetUrl}
            >
              {busy && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteLinkDialog({
  link,
  origin,
  onClose,
  onDeleted,
}: {
  link: ShortLink | null
  origin: string
  onClose: () => void
  onDeleted: (link: ShortLink) => void
}) {
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  const remove = async () => {
    if (!link || busy) return
    setBusy(true)
    try {
      await apiRequest(`/api/urls/${link.id}`, {
        method: 'DELETE',
        fallback: 'Your link still works. Try again.',
      })
      onDeleted(link)
    } catch (failure) {
      toast({
        title: 'Could not delete the link',
        description:
          failure instanceof RefusedRequest
            ? failure.message
            : 'Your link still works. Try again.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog
      open={Boolean(link)}
      onOpenChange={(open) => !open && !busy && onClose()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this link?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="break-all font-mono text-foreground">
              {link && shortLinkUrl(link.shortCode, origin)}
            </span>{' '}
            will stop working, and anyone on this Flare can then use its ending
            for a link of their own.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep link</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => void remove()}
            disabled={busy}
          >
            {busy && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            )}
            Delete link
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
