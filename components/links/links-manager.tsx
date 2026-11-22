'use client'

import {
  type FormEvent,
  useCallback,
  useEffect,
  useId,
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
  Download,
  Loader2,
  MoreHorizontal,
  Pencil,
  QrCode,
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

import { copyText, copyWhenReady } from '@/lib/client/clipboard'
import { takeHandoff } from '@/lib/client/handoff'
import { RefusedRequest, apiRequest } from '@/lib/client/request'
import {
  sameDestination,
  suggestEnding,
  trackingParameters,
  withScheme,
} from '@/lib/links/compose'
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

/**
 * A destination as people read it: without `https://`, which says nothing.
 * `http://` stays, since an insecure destination is worth seeing. (Upload
 * shows its own links without either: their scheme is the instance's.)
 */
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
  const loaded = useRef(false)
  const [query, setQuery] = useState('')
  const [fresh, setFresh] = useState<string>()
  const [copied, setCopied] = useState<string>()
  const [editing, setEditing] = useState<ShortLink | null>(null)
  const [deleting, setDeleting] = useState<ShortLink | null>(null)
  const [coding, setCoding] = useState<ShortLink | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const load = useCallback(
    /** `quiet`: a re-read after a change, which keeps the list on failure. */
    async (signal?: AbortSignal, quiet = false) => {
      const version = ++requestVersion.current
      try {
        const data = await apiRequest<{ urls?: ShortLink[] }>('/api/urls', {
          signal,
        })
        if (signal?.aborted || version !== requestVersion.current) return
        setLinks(data.urls ?? [])
        setLoadError('')
        loaded.current = true
      } catch (failure) {
        if (signal?.aborted || version !== requestVersion.current) return
        // The list on screen, the new row included, stays right; only a
        // list that never loaded needs the error and Try again.
        if (quiet && loaded.current) return
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
  const reconcile = () => void load(undefined, true)

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

  const showCopied = (link: ShortLink) => {
    setCopied(link.id)
    setTimeout(
      () => setCopied((current) => (current === link.id ? undefined : current)),
      2000
    )
  }

  const copy = async (link: ShortLink) => {
    if (await copyText(shortLinkUrl(link.shortCode, window.location.origin))) {
      showCopied(link)
      toast({ title: 'Link copied' })
    } else
      toast({
        title: 'Could not copy the link',
        description: 'Press and hold or right-click the link to copy it.',
        variant: 'destructive',
      })
  }

  const listError = (
    <Alert variant="destructive">
      <AlertCircle aria-hidden="true" />
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>{loadError}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            // Rows already on screen stay while the list is read again.
            if (!links.length) setLoading(true)
            void load()
          }}
        >
          <RefreshCw aria-hidden="true" />
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  )

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
            <LinkComposer
              origin={origin}
              links={links}
              onCopyExisting={(link) => void copy(link)}
              onCreated={(link, copying) => {
                setLinks((current) => [link, ...current])
                // The new link always shows, whatever was searched for.
                setQuery('')
                setFresh(link.id)
                reconcile()
                const made = shortLinkUrl(link.shortCode, origin)
                void copying.then((copiedNow) => {
                  if (copiedNow) showCopied(link)
                  setAnnouncement(
                    copiedNow ? `Created and copied ${made}` : `Created ${made}`
                  )
                  toast({ title: copiedNow ? 'Link copied' : 'Link created' })
                })
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
        ) : links.length === 0 ? (
          loadError ? (
            listError
          ) : (
            <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              No links yet.
            </p>
          )
        ) : shown.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            No links match “{query.trim()}”.
          </p>
        ) : (
          <>
            {/* Links made here stay usable while the list can't load. */}
            {loadError && <div className="mb-3">{listError}</div>}
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
                  onQrCode={() => setCoding(link)}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      <QrCodeDialog
        link={coding}
        origin={origin}
        onClose={() => setCoding(null)}
        onCopy={(link) => void copy(link)}
      />
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

/**
 * Where a link is made. It reads the long link as it arrives: adds a
 * missing `https://`, offers to drop tracking parameters, names a link
 * already made for it, and suggests an ending from its words. Enter makes the
 * link and copies it in the same key press.
 */
function LinkComposer({
  origin,
  links,
  onCreated,
  onCopyExisting,
}: {
  origin: string
  links: readonly ShortLink[]
  onCreated: (link: ShortLink, copying: Promise<boolean>) => void
  onCopyExisting: (link: ShortLink) => void
}) {
  const [url, setUrl] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [removed, setRemoved] = useState<{
    names: string[]
    from: string
  } | null>(null)
  const host = origin.replace(/^https?:\/\//, '')
  const suggestionId = useId()
  const field = useRef<HTMLInputElement>(null)
  // People arrive with a link to paste, or one handed over by Paste; a
  // phone's keyboard waits for a tap. Taken once the page is on screen, as a
  // render can be thrown away and run again.
  useEffect(() => {
    const handed = takeHandoff('link')
    if (handed) setUrl(handed.url)
    if (window.matchMedia('(pointer: fine)').matches) field.current?.focus()
  }, [])

  const address = withScheme(url)
  const tracking = useMemo(() => trackingParameters(address), [address])
  const suggestion = useMemo(
    () => (code ? null : suggestEnding(address)),
    [address, code]
  )
  const existing = useMemo(
    () =>
      address
        ? links.find((link) => sameDestination(link.targetUrl, address))
        : undefined,
    [links, address]
  )

  const change = (next: string) => {
    setUrl(next)
    setRemoved(null)
    if (error) setError('')
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError('')
    let body: z.infer<typeof shortLinkInputSchema>
    try {
      body = shortLinkInputSchema.parse({ url: address, code })
    } catch (failure) {
      setError(problem(failure, 'Check the link and try again.'))
      return
    }
    setUrl(address)
    setBusy(true)
    const creating = apiRequest<ShortLink>('/api/urls', {
      body,
      fallback: 'Could not create the link. Try again.',
    })
    // Asked for now, while the key press still allows it; written once the
    // link exists.
    const copying = copyWhenReady(
      creating.then((link) =>
        shortLinkUrl(link.shortCode, window.location.origin)
      )
    )
    creating.then(
      (link) => {
        setUrl('')
        setCode('')
        setRemoved(null)
        setBusy(false)
        onCreated(link, copying)
      },
      (failure) => {
        setError(problem(failure, 'Could not create the link. Try again.'))
        setBusy(false)
      }
    )
  }

  const notes = [
    tracking && (
      <span
        key="tracking"
        className="inline-flex flex-wrap items-center gap-x-1.5"
      >
        <span>
          {tracking.names.length === 1
            ? `It carries a tracking parameter, ${tracking.names[0]}.`
            : `It carries ${tracking.names.length} tracking parameters.`}
        </span>
        <button
          type="button"
          className="font-medium text-foreground underline underline-offset-4"
          onClick={() => {
            setRemoved({ names: tracking.names, from: address })
            setUrl(tracking.cleaned)
          }}
        >
          Remove {tracking.names.length === 1 ? 'it' : 'them'}
        </button>
      </span>
    ),
    removed && !tracking && (
      <span
        key="removed"
        className="inline-flex flex-wrap items-center gap-x-1.5"
      >
        <span>Removed {removed.names.join(', ')}.</span>
        <button
          type="button"
          className="font-medium text-foreground underline underline-offset-4"
          onClick={() => {
            setUrl(removed.from)
            setRemoved(null)
          }}
        >
          Undo
        </button>
      </span>
    ),
    existing && (
      <span
        key="existing"
        className="inline-flex flex-wrap items-center gap-x-1.5"
      >
        <span>
          You already have{' '}
          <span className="font-mono text-foreground">
            /u/{existing.shortCode}
          </span>{' '}
          for this ({clicks(existing.clicks)}).
        </span>
        <button
          type="button"
          className="font-medium text-foreground underline underline-offset-4"
          onClick={() => onCopyExisting(existing)}
        >
          Copy it
        </button>
      </span>
    ),
  ].filter(Boolean)

  return (
    <form
      onSubmit={submit}
      noValidate
      className="rounded-xl border bg-background/40 p-3 transition-colors focus-within:border-ring/60 sm:p-4"
    >
      <Input
        type="url"
        inputMode="url"
        aria-label="Link to shorten"
        placeholder="Paste a long link"
        value={url}
        onChange={(event) => change(event.target.value)}
        onBlur={() => {
          if (address !== url.trim()) setUrl(address)
        }}
        onPaste={(event) => {
          const pasted = event.clipboardData.getData('text/plain').trim()
          if (!pasted || url.trim()) return
          event.preventDefault()
          change(withScheme(pasted))
        }}
        disabled={busy}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? 'link-error' : undefined}
        ref={field}
        className="h-11 border-0 bg-transparent px-1 text-base shadow-none focus-visible:ring-0 sm:text-[15px]"
      />
      <div className="mt-2 flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row sm:items-center">
        {/* The link being made: the instance, then the ending. */}
        <div className="flex h-10 min-w-0 flex-1 items-center rounded-md bg-muted/30 font-mono text-sm focus-within:ring-1 focus-within:ring-ring">
          <span
            className="flex min-w-0 max-w-[60%] shrink-0 pl-3 text-muted-foreground"
            title={`${host}/u/`}
          >
            <span className="hidden truncate sm:inline">{host}</span>
            <span className="shrink-0">/u/</span>
          </span>
          <input
            aria-label="Ending (optional)"
            aria-describedby={suggestion ? suggestionId : undefined}
            placeholder={suggestion ?? 'random'}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            onKeyDown={(event) => {
              // Tab takes the suggestion, as in a code editor; the next Tab
              // moves on.
              if (
                event.key === 'Tab' &&
                !event.shiftKey &&
                suggestion &&
                !code
              ) {
                event.preventDefault()
                setCode(suggestion)
              }
            }}
            disabled={busy}
            maxLength={SHORT_CODE_MAX_LENGTH}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            className={cn(
              'h-full min-w-0 flex-1 bg-transparent pr-2 outline-none',
              suggestion
                ? 'placeholder:text-muted-foreground/45'
                : 'placeholder:text-muted-foreground/70'
            )}
          />
          {suggestion && (
            <button
              type="button"
              onClick={() => setCode(suggestion)}
              aria-label={`Use ${suggestion}`}
              title={`Use ${suggestion}`}
              className="mr-1.5 shrink-0 rounded border border-border/80 px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="[@media(pointer:coarse)]:hidden">Tab</span>
              <span className="hidden [@media(pointer:coarse)]:inline">
                Use
              </span>
            </button>
          )}
          <span id={suggestionId} className="sr-only">
            {suggestion
              ? `Suggested ending: ${suggestion}. Press Tab to use it; left empty, the ending is random.`
              : ''}
          </span>
        </div>
        <Button
          type="submit"
          disabled={busy || !url.trim()}
          className="h-10 sm:w-auto"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : null}
          Shorten
          {!busy && (
            <kbd className="ml-1 hidden rounded border border-current/30 px-1 font-sans text-[11px] leading-4 opacity-70 [@media(pointer:fine)]:sm:inline">
              ↵
            </kbd>
          )}
        </Button>
      </div>
      {(notes.length > 0 || error) && (
        <div className="mt-2.5 space-y-1 px-1 text-sm text-muted-foreground">
          {notes.map((note, index) => (
            <p key={index}>{note}</p>
          ))}
          {error && (
            <p id="link-error" role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </div>
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
  onQrCode,
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
  onQrCode: () => void
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
          <DropdownMenuItem onSelect={onQrCode}>
            <QrCode className="h-4 w-4" aria-hidden="true" />
            QR code
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

/**
 * The short link as a QR code, for a slide, a poster or a phone across the
 * room. Made in the browser; nothing is sent anywhere.
 */
function QrCodeDialog({
  link,
  origin,
  onClose,
  onCopy,
}: {
  link: ShortLink | null
  origin: string
  onClose: () => void
  onCopy: (link: ShortLink) => void
}) {
  const [image, setImage] = useState<{ for: string; url: string } | null>(null)
  const [failed, setFailed] = useState(false)
  const address = link ? shortLinkUrl(link.shortCode, origin) : ''

  useEffect(() => {
    if (!address) return
    let current = true
    setFailed(false)
    import('qrcode')
      .then((QRCode) =>
        QRCode.toDataURL(address, {
          width: 768,
          margin: 2,
          errorCorrectionLevel: 'M',
          color: { dark: '#000000', light: '#ffffff' },
        })
      )
      .then(
        (url) => {
          if (current) setImage({ for: address, url })
        },
        () => {
          if (current) setFailed(true)
        }
      )
    return () => {
      current = false
    }
  }, [address])

  const ready = image?.for === address ? image.url : null

  return (
    <Dialog open={!!link} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>QR code</DialogTitle>
          <DialogDescription className="break-all font-mono text-xs">
            {address.replace(/^https?:\/\//, '')}
          </DialogDescription>
        </DialogHeader>
        <div className="mx-auto flex aspect-square w-full max-w-64 items-center justify-center overflow-hidden rounded-xl bg-white p-2">
          {ready ? (
            // A data URL made here; next/image would only add a wrapper.
            <img
              src={ready}
              alt={`QR code for ${address}`}
              className="h-full w-full [image-rendering:pixelated]"
            />
          ) : failed ? (
            <p className="px-4 text-center text-sm text-neutral-600">
              The QR code could not be made. Copy the link instead.
            </p>
          ) : (
            <Loader2
              className="h-6 w-6 animate-spin text-neutral-400"
              aria-label="Making the QR code"
            />
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => link && onCopy(link)}
            disabled={!link}
          >
            <Copy className="h-4 w-4" aria-hidden="true" />
            Copy link
          </Button>
          <Button asChild disabled={!ready}>
            <a
              href={ready ?? undefined}
              download={link ? `${link.shortCode}-qr.png` : undefined}
              aria-disabled={!ready}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Download PNG
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
