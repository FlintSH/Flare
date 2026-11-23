'use client'

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

import { formatDistanceToNowStrict } from 'date-fns'
import { Check, Copy, Loader2, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'

import { copyText } from '@/lib/client/clipboard'
import { LINKS_CHANGED, linkCarriesCredential } from '@/lib/client/give'
import { RefusedRequest, apiRequest } from '@/lib/client/request'
import { withScheme } from '@/lib/links/compose'
import {
  type ShortLink,
  shortLinkUpdateSchema,
  shortLinkUrl,
} from '@/lib/links/schema'
import { cn } from '@/lib/utils'

import { usePermissions } from '@/hooks/use-permissions'
import { useToast } from '@/hooks/use-toast'

/**
 * One short link's home, in the same frame as a file's: the link to copy, a
 * QR code, where it leads (changed in place), its clicks, and delete.
 */
export function LinkSheet({
  id,
  onClose,
}: {
  id: string
  onClose: () => void
}) {
  const [link, setLink] = useState<ShortLink | null>(null)
  const [missing, setMissing] = useState(false)
  // A request that failed isn't a missing link: the sheet offers a retry.
  const [failed, setFailed] = useState(false)

  // Only the newest request answers, so a slow first load can't replace
  // the refresh after a save.
  const latestRequest = useRef(0)
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const request = ++latestRequest.current
      try {
        const data = await apiRequest<{ urls?: ShortLink[] }>(
          `/api/urls?${new URLSearchParams({ id })}`,
          { signal }
        )
        if (signal?.aborted || request !== latestRequest.current) return
        const found = data.urls?.find((entry) => entry.id === id)
        setLink(found ?? null)
        setMissing(!found)
        setFailed(false)
      } catch (failure) {
        if (signal?.aborted || request !== latestRequest.current) return
        // Refused for what was asked (or by role): there's no such link to
        // open, not a connection to retry.
        const refused =
          failure instanceof RefusedRequest &&
          failure.status >= 400 &&
          failure.status < 500 &&
          failure.status !== 429
        if (refused) setMissing(true)
        else setFailed(true)
      }
    },
    [id]
  )
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        // A light scrim, no blur: the page you came from stays in view.
        overlayClassName="bg-[color-mix(in_srgb,var(--scrim)_60%,transparent)] backdrop-blur-none"
        tabIndex={-1}
        // Esc in a field being edited closes that field, not the sheet.
        onEscapeKeyDown={(event) => {
          if (
            (event.target as Element | null)?.closest?.('[data-inline-editor]')
          )
            event.preventDefault()
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          ;(event.currentTarget as HTMLElement | null)?.focus()
        }}
        aria-busy={!link && !missing && !failed}
        className="flex w-full flex-col gap-0 overflow-hidden p-0 outline-none sm:max-w-[30rem]"
      >
        {link ? (
          <LinkSheetBody
            link={link}
            onChanged={load}
            onSaved={setLink}
            onClose={onClose}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
            <SheetTitle className="text-base">
              {missing
                ? 'This link isn’t here'
                : failed
                  ? 'Couldn’t open it'
                  : 'Opening…'}
            </SheetTitle>
            <SheetDescription>
              {missing
                ? 'It may have been deleted.'
                : failed
                  ? 'Flare didn’t answer. Check your connection and try again.'
                  : ' '}
            </SheetDescription>
            {failed && !missing && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFailed(false)
                  void load()
                }}
              >
                Try again
              </Button>
            )}
            {!link && !missing && !failed && (
              <Loader2
                className="h-5 w-5 animate-spin text-muted-foreground"
                aria-hidden="true"
              />
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

/** An address that wraps after its slashes and before ? and &, not mid-word. */
function withBreaks(address: string) {
  return address
    .split(/(?<=[/?&])/)
    .flatMap((part, index) => (index ? [<wbr key={index} />, part] : [part]))
}

/** Where a link leads, by its site: what people know it as. */
function destinationHost(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-3 px-5 py-2.5">
      <dt className="flex min-h-8 items-center [@media(pointer:coarse)]:min-h-11 text-sm text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

function LinkSheetBody({
  link,
  onChanged,
  onSaved,
  onClose,
}: {
  link: ShortLink
  onChanged: () => Promise<void> | void
  onSaved: (link: ShortLink) => void
  onClose: () => void
}) {
  const { can } = usePermissions()
  const { toast } = useToast()
  const canEdit = can('links.create') && can('links.delete')
  const canDelete = can('links.delete')
  const short = shortLinkUrl(link.shortCode, window.location.origin)
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(copiedTimer.current), [])
  const [qr, setQr] = useState<string | null>(null)
  const [destination, setDestination] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [invalid, setInvalid] = useState<string | null>(null)
  // A ref as well as `busy`: two presses in one frame both see it unset.
  const running = useRef(false)
  // The new destination, said before it's public, as everywhere else.
  const destinationCarries =
    destination === null
      ? null
      : linkCarriesCredential(withScheme(destination.trim()))
  // Closing the field puts focus back on Change.
  const closeDestination = () => {
    setDestination(null)
    setInvalid(null)
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>('[data-edit-trigger="destination"]')
        ?.focus()
    )
  }

  useEffect(() => {
    let live = true
    import('qrcode')
      .then((QRCode) =>
        QRCode.toDataURL(short, {
          margin: 2,
          // Sharp enough to print: the size the old QR dialog downloaded.
          width: 768,
          errorCorrectionLevel: 'M',
        })
      )
      .then((url) => live && setQr(url))
      // Shown as unavailable rather than loading for ever.
      .catch(() => live && setQr('failed'))
    return () => {
      live = false
    }
  }, [short])

  const changed = async () => {
    window.dispatchEvent(new Event(LINKS_CHANGED))
    await onChanged()
  }
  const save = async () => {
    if (destination === null || busy || running.current) return
    // Checked here first, with the reason under the field.
    const checked = shortLinkUpdateSchema.safeParse({
      url: withScheme(destination.trim()),
    })
    if (!checked.success)
      return setInvalid(
        checked.error.issues[0]?.message ?? 'Check the address and try again.'
      )
    setInvalid(null)
    running.current = true
    setBusy(true)
    try {
      const updated = await apiRequest<ShortLink>(`/api/urls/${link.id}`, {
        method: 'PATCH',
        body: { url: withScheme(destination.trim()) },
        fallback: 'The destination couldn’t be changed.',
      })
      // Shown from what was saved, even if the reload after it fails.
      onSaved(updated)
      closeDestination()
      // The sheet already shows what was saved; the lists catch up after.
      void changed()
      toast({ title: 'Destination changed' })
    } catch (failure) {
      toast({
        title: 'That didn’t save',
        description: failure instanceof Error ? failure.message : undefined,
        variant: 'destructive',
      })
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const remove = async () => {
    if (running.current) return
    running.current = true
    setBusy(true)
    try {
      await apiRequest(`/api/urls/${link.id}`, {
        method: 'DELETE',
        fallback: 'The link couldn’t be deleted.',
      })
      window.dispatchEvent(new Event(LINKS_CHANGED))
      toast({ title: 'Link deleted' })
      onClose()
    } catch (failure) {
      running.current = false
      setBusy(false)
      toast({
        title: 'Could not delete the link',
        description: failure instanceof Error ? failure.message : undefined,
        variant: 'destructive',
      })
    }
  }

  return (
    <>
      <header className="flex items-start gap-3 px-5 pb-4 pr-14 pt-5">
        <div className="min-w-0 flex-1">
          <SheetTitle className="truncate text-base font-semibold">
            {destinationHost(link.targetUrl)}
          </SheetTitle>
          <SheetDescription className="text-xs">
            Short link · made{' '}
            {formatDistanceToNowStrict(new Date(link.createdAt), {
              addSuffix: true,
            })}
          </SheetDescription>
        </div>
      </header>

      {/* The header and footer stay; what is between them scrolls. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-center gap-2 border-t border-border/60 px-5 py-4">
          <code
            className="min-w-0 flex-1 truncate rounded-lg border border-border/60 bg-background/60 px-3 py-2 font-mono text-xs text-muted-foreground"
            title={short}
          >
            <span className="max-sm:hidden">{new URL(short).host}</span>
            {new URL(short).pathname}
          </code>
          <Button
            size="sm"
            className="h-9"
            onClick={async () => {
              if (await copyText(short)) {
                setCopied(true)
                // Each copy shows Copied for its own two seconds.
                clearTimeout(copiedTimer.current)
                copiedTimer.current = setTimeout(() => setCopied(false), 2000)
                toast({ title: 'Link copied' })
              } else
                toast({
                  title: 'Couldn’t copy the link',
                  description: 'Select it and copy it yourself.',
                  variant: 'destructive',
                })
            }}
          >
            {copied ? (
              <Check className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Copy className="h-4 w-4" aria-hidden="true" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>

        <dl className="divide-y divide-border/60 border-t border-border/60">
          <Row label="Leads to">
            {destination === null ? (
              <div className="flex min-h-8 items-center [@media(pointer:coarse)]:min-h-11 gap-1 text-sm">
                <a
                  href={link.targetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 break-words underline-offset-4 hover:underline"
                >
                  {withBreaks(link.targetUrl.replace(/^https:\/\//, ''))}
                </a>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    data-edit-trigger="destination"
                    disabled={busy}
                    onClick={() => setDestination(link.targetUrl)}
                  >
                    Change
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-1.5">
                <form
                  data-inline-editor
                  // Esc anywhere in the field (its buttons too) closes it.
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') return
                    event.stopPropagation()
                    // Not while it saves: a failed save keeps the field.
                    if (!busy) closeDestination()
                  }}
                  // Bare addresses (example.com/page) are fine: Flare adds
                  // https:// itself, so the browser's URL check stays out.
                  noValidate
                  className="flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void save()
                  }}
                >
                  <Input
                    autoFocus
                    type="url"
                    aria-label="New destination"
                    readOnly={busy}
                    aria-invalid={Boolean(invalid)}
                    aria-describedby="destination-note"
                    value={destination}
                    onChange={(event) => {
                      setDestination(event.target.value)
                      setInvalid(null)
                    }}
                    className="h-8 min-w-0 flex-1"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    className="h-8"
                    disabled={
                      busy ||
                      !destination.trim() ||
                      withScheme(destination.trim()) === link.targetUrl
                    }
                  >
                    {busy && (
                      <Loader2
                        className="h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                    )}
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    disabled={busy}
                    onClick={closeDestination}
                  >
                    Cancel
                  </Button>
                </form>
                <p
                  id="destination-note"
                  role={invalid ? 'alert' : undefined}
                  className={cn(
                    'text-xs',
                    invalid
                      ? 'text-destructive'
                      : destinationCarries
                        ? 'font-medium text-warning'
                        : 'text-muted-foreground'
                  )}
                >
                  {invalid ??
                    (destinationCarries
                      ? `It carries ${destinationCarries}. Everyone with the short link could use it.`
                      : 'Everyone who opens the short link goes here from then on.')}
                </p>
              </div>
            )}
          </Row>
          <Row label="Clicks">
            <span className="flex min-h-8 items-center [@media(pointer:coarse)]:min-h-11 text-sm tabular-nums text-muted-foreground">
              {link.clicks.toLocaleString()}
            </span>
          </Row>
          <Row label="QR code">
            <div className="flex items-start gap-3">
              {qr === 'failed' ? (
                <span className="flex min-h-8 items-center text-sm text-muted-foreground [@media(pointer:coarse)]:min-h-11">
                  Couldn’t make the code here.
                </span>
              ) : qr ? (
                <img
                  src={qr}
                  alt={`QR code for ${short}`}
                  className="h-20 w-20 rounded-md bg-white p-1"
                />
              ) : (
                <div className="h-20 w-20 animate-pulse rounded-md bg-muted" />
              )}
              {qr && qr !== 'failed' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-8"
                  asChild
                >
                  <a href={qr} download={`${link.shortCode}-qr.png`}>
                    Download
                  </a>
                </Button>
              )}
            </div>
          </Row>
        </dl>
      </div>

      {/* Delete is the footer's one action; without it there's no footer. */}
      {canDelete && (
        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border/60 bg-overlay px-5 py-4">
          {confirming ? (
            <span className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Keep
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => void remove()}
              >
                Delete link
              </Button>
            </span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-destructive hover:bg-danger/10 hover:text-destructive"
              onClick={() => setConfirming(true)}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Delete
            </Button>
          )}
        </footer>
      )}
    </>
  )
}
