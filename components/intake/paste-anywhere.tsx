'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'

import { usePathname, useRouter } from 'next/navigation'

import {
  AlertCircle,
  FileText,
  Files,
  Link as LinkIcon,
  Loader2,
  ShieldAlert,
  X,
} from 'lucide-react'

import { FolderName, dropFolder } from '@/components/dashboard/global-drop-zone'
import { Button } from '@/components/ui/button'
import { ToastAction } from '@/components/ui/toast'

import { openLinkSheet } from '@/lib/client/file-sheet'
import { type Gift, readGift, shortenAndCopy } from '@/lib/client/give'
import { handOff } from '@/lib/client/handoff'
import { isEditable, pasteClaimed } from '@/lib/client/paste-claim'
import { detectLanguage, suggestPasteName } from '@/lib/files/detect-language'
import { allows } from '@/lib/permissions/actions'
import { savedOutcome } from '@/lib/uploads/choices'
import type { SavedUploadSettings } from '@/lib/uploads/saved-settings'
import { uploadTray } from '@/lib/uploads/tray'
import { cn, formatBytes } from '@/lib/utils'

import { useFreshDefaults } from '@/hooks/use-fresh-defaults'
import { usePermissions } from '@/hooks/use-permissions'
import { useToast } from '@/hooks/use-toast'

/** Enter does nothing this long after the card appears, so a reflex can't confirm it. */
const SETTLE_MS = 400

/**
 * Menus, popovers, dialogs and the lightbox own the keyboard while open. A
 * tooltip is a popper too, but owns nothing.
 */
function somethingOpen() {
  return Boolean(
    document.querySelector(
      '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]:not(:has([role="tooltip"]))'
    )
  )
}

const plural = (count: number, word: string) =>
  `${count} ${count === 1 ? word : `${word}s`}`

/**
 * Paste anywhere: on any dashboard page without its own paste handling,
 * something pasted while no field has focus gets a card under the bar that
 * says what it is and offers the one thing to do with it. Files upload,
 * a link is shortened, text opens in Paste. Nothing pasted leaves the page
 * until the action is chosen.
 */
export function PasteAnywhere({
  maxSize,
  saved,
}: {
  maxSize: number
  saved: SavedUploadSettings | null
}) {
  const { user, can } = usePermissions()
  const router = useRouter()
  const { read: readDefaults, reading } = useFreshDefaults()
  const pathname = usePathname()
  const { toast } = useToast()
  const [gift, setGift] = useState<Gift | null>(null)
  const [shownAt, setShownAt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const returnFocus = useRef<HTMLElement | null>(null)
  // Each card is a generation; a request answers only the card that sent it.
  const generation = useRef(0)
  const action = useRef<HTMLButtonElement>(null)

  const canUpload = allows(user, 'uploadFiles')
  const canShorten = can('links.create')
  const canPaste = allows(user, 'createPaste')
  // A paste that can be made private (a credential link may only go there so).
  const privatePaste = canPaste && allows(user, 'shareFiles')
  const offered = (next: Gift) =>
    next.kind === 'files'
      ? canUpload
      : next.kind === 'link'
        ? canShorten || canPaste
        : canPaste

  const dismiss = useCallback(() => {
    // A shortening still on its way answers nothing once this is gone.
    generation.current += 1
    setGift(null)
    setError('')
    setBusy(false)
    const back = returnFocus.current
    returnFocus.current = null
    if (back?.isConnected) back.focus()
  }, [])

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (
        event.defaultPrevented ||
        pasteClaimed() ||
        isEditable(event.target) ||
        somethingOpen() ||
        !event.clipboardData
      )
        return
      const next = readGift({
        files: Array.from(event.clipboardData.files),
        text: event.clipboardData.getData('text/plain'),
      })
      if (!next || !offered(next)) return
      event.preventDefault()
      if (!returnFocus.current)
        returnFocus.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null
      generation.current += 1
      if (next.kind === 'files') readDefaults()
      setGift(next)
      setError('')
      setBusy(false)
      setShownAt(performance.now())
    }
    document.addEventListener('paste', paste)
    return () => document.removeEventListener('paste', paste)
  })

  // Moving to another page puts the card away.
  useEffect(() => {
    setGift(null)
  }, [pathname])

  // Focus goes to the action, or to Dismiss when the card has none.
  const dismissButton = useRef<HTMLButtonElement>(null)
  const confirming = useRef<number | null>(null)
  useEffect(() => {
    if (!gift) return
    ;(action.current ?? dismissButton.current)?.focus({ preventScroll: true })
  }, [gift])
  // Leaving the card any way but Dismiss lets go of where focus was.
  useEffect(() => {
    if (!gift) returnFocus.current = null
  }, [gift])

  // A pasted image shows itself; its address is let go with the card.
  const image =
    gift?.kind === 'files'
      ? gift.files.find((file) => file.type.startsWith('image/'))
      : undefined
  const [preview, setPreview] = useState<string>()
  useEffect(() => {
    if (!image) return setPreview(undefined)
    const url = URL.createObjectURL(image)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [image])

  if (!gift) return null

  const folderId =
    typeof window === 'undefined' ? null : dropFolder(window.location, user)
  // Claimed only once the defaults read on opening are in.
  const current = reading ? null : saved
  const outcome = current
    ? savedOutcome(current.effective, allows(user, 'shareFiles'))
    : null

  const confirm = async () => {
    // A ref as well as `busy`: two presses in one frame both see it unset.
    // Per card: one pasted over a card still at work starts free.
    const card = generation.current
    if (busy || confirming.current === card) return
    confirming.current = card
    try {
      await act()
    } finally {
      if (confirming.current === card) confirming.current = null
    }
  }
  const act = async () => {
    setError('')
    if (gift.kind === 'files') {
      const tooLarge = uploadTray().add(gift.files, maxSize, {
        options: { folderId },
      })
      if (tooLarge.length)
        toast({
          title: `${plural(tooLarge.length, 'file')} over ${formatBytes(maxSize)}`,
          description: 'Those weren’t uploaded.',
          variant: 'destructive',
        })
      dismiss()
      return
    }
    if (gift.kind === 'text') {
      // Text holding a secret goes only as a private paste.
      if (gift.secret && !privatePaste) return
      handOff({ kind: 'text', text: gift.text, private: Boolean(gift.secret) })
      setGift(null)
      router.push('/dashboard/paste')
      return
    }
    // A link carrying a credential is never shortened from here, as in
    // Find: Links shows it, where making it public is a deliberate step.
    if (gift.carries && canShorten && allows(user, 'viewLinks'))
      return customize()
    if (gift.carries && !privatePaste) return
    if (!canShorten || gift.carries) {
      if (!canPaste) return
      // A credential link becomes a private paste, never a public one.
      handOff({ kind: 'text', text: gift.url, private: Boolean(gift.carries) })
      setGift(null)
      router.push('/dashboard/paste')
      return
    }
    setBusy(true)
    const sent = generation.current
    try {
      const made = await shortenAndCopy(gift.url)
      toast({
        title: made.copied ? 'Short link copied' : 'Short link made',
        description: made.link.replace(/^https?:\/\//, ''),
        action: !allows(user, 'viewLinks') ? undefined : (
          <ToastAction
            altText="Manage the link"
            onClick={() => openLinkSheet(made.id)}
          >
            Manage
          </ToastAction>
        ),
      })
      if (generation.current === sent) dismiss()
    } catch (failure) {
      if (generation.current !== sent) return
      setBusy(false)
      setError(
        failure instanceof Error
          ? failure.message
          : 'Could not create the link. Try again.'
      )
    }
  }

  const customize = () => {
    if (gift.kind !== 'link') return
    handOff({ kind: 'link', url: gift.url })
    setGift(null)
    router.push('/dashboard/urls')
  }

  // A link that carries a credential is shown masked, with what it carries.
  const carries = gift.kind === 'link' && Boolean(gift.carries)
  const toLinks = canShorten && allows(user, 'viewLinks')
  const Icon =
    gift.kind === 'files' ? Files : gift.kind === 'link' ? LinkIcon : FileText
  const title =
    gift.kind === 'files'
      ? `${plural(gift.files.length, gift.files.every((file) => file.type.startsWith('image/')) ? 'image' : 'file')} · ${formatBytes(gift.files.reduce((sum, file) => sum + file.size, 0))}`
      : gift.kind === 'link'
        ? gift.url.replace(/^https?:\/\//, '')
        : // A name made from text holding a secret could show the secret.
          gift.secret
          ? plural(gift.lines, 'line')
          : `${plural(gift.lines, 'line')} · ${suggestPasteName(gift.text, detectLanguage(gift.text))}`
  const detail =
    gift.kind === 'files'
      ? [
          // Unknown until the saved settings load: not claimed either way.
          outcome && (outcome.visibility === 'PUBLIC' ? 'Public' : 'Private'),
          outcome?.expires,
          folderId ? <FolderName key="folder" id={folderId} /> : 'Unfiled',
          current?.profile ? `${current.profile.name} profile` : null,
        ]
          .filter(Boolean)
          .map((part, index) => (
            <Fragment key={index}>
              {index > 0 && ' · '}
              {part}
            </Fragment>
          ))
      : gift.kind === 'link' && gift.carries
        ? toLinks
          ? `This link carries ${gift.carries}, so it isn’t shortened from here. Links shows it, and making it public is up to you.`
          : privatePaste
            ? `This link carries ${gift.carries}. It opens in Paste as a private paste.`
            : `This link carries ${gift.carries}, so it isn’t shortened or shared from here.`
        : gift.kind === 'link' && canShorten
          ? 'A short link with a random ending, copied for you.'
          : gift.kind === 'text' && gift.secret
            ? privatePaste
              ? `Looks like ${gift.secret}. It opens in Paste as a private paste.`
              : `Looks like ${gift.secret}, so it isn’t shared from here.`
            : 'Opens in Paste, where you choose how to share it.'
  const label =
    gift.kind === 'files'
      ? 'Upload'
      : gift.kind === 'link'
        ? carries
          ? toLinks
            ? 'Open in Links'
            : privatePaste
              ? 'Open in Paste'
              : null
          : canShorten
            ? 'Shorten'
            : 'Open in Paste'
        : gift.secret && !privatePaste
          ? null
          : 'Open in Paste'

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[5.5rem] z-40 flex justify-center px-4">
      <section
        role="region"
        aria-label="Pasted"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            dismiss()
          }
          // Enter can't confirm a moment after the card appears.
          if (event.key === 'Enter' && performance.now() - shownAt < SETTLE_MS)
            event.preventDefault()
        }}
        className="pointer-events-auto w-full max-w-xl rounded-2xl border border-border bg-overlay p-3 shadow-xl shadow-black/20 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-2 dark:shadow-black/60 sm:p-4"
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/50',
              (carries || (gift.kind === 'text' && gift.secret)) &&
                'border-warning/40 bg-warning/10 text-warning'
            )}
          >
            {preview ? (
              <img
                src={preview}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : carries || (gift.kind === 'text' && gift.secret) ? (
              <ShieldAlert className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Icon className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p
              className="truncate text-sm font-medium"
              title={
                gift.kind === 'link' && carries
                  ? maskLinkForDisplay(gift.url)
                  : title
              }
            >
              {gift.kind === 'link' && carries
                ? maskLinkForDisplay(gift.url)
                : title}
            </p>
            <p className="mt-0.5 text-pretty text-xs text-muted-foreground">
              {detail}
            </p>
            {/* Text that seems to hold a secret isn't previewed at all: it may
                hold more than the one the card names. */}
            {gift.kind === 'text' && !gift.secret && (
              <pre className="mt-2 max-h-20 overflow-hidden whitespace-pre-wrap break-all rounded-md bg-muted/40 px-2 py-1.5 font-mono text-[11px] leading-4 text-muted-foreground [mask-image:linear-gradient(to_bottom,black_60%,transparent)]">
                {gift.text.slice(0, 600)}
              </pre>
            )}
            {error && (
              <p
                role="alert"
                className="mt-1.5 flex items-start gap-1.5 text-xs text-destructive"
              >
                <AlertCircle
                  className="mt-px h-3.5 w-3.5 shrink-0"
                  aria-hidden="true"
                />
                {error}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="-mr-1 -mt-1 h-8 w-8 shrink-0 text-muted-foreground"
            ref={dismissButton}
            aria-label="Dismiss"
            title="Dismiss (Esc)"
            onClick={dismiss}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {gift.kind === 'link' && !carries && toLinks && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={customize}
            >
              Choose an ending
            </Button>
          )}
          {label && (
            <Button
              ref={action}
              size="sm"
              disabled={busy}
              onClick={() => void confirm()}
              variant="default"
            >
              {busy && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {error && gift.kind === 'link' ? 'Try again' : label}
              {
                <kbd className="ml-1 hidden rounded border border-current/30 px-1 font-sans text-[10px] opacity-70 sm:inline">
                  ↵
                </kbd>
              }
            </Button>
          )}
        </div>
      </section>
    </div>
  )
}

/**
 * A link that carries a credential, shown by its host alone: the token can
 * be in the path as well as the query.
 */
function maskLinkForDisplay(url: string) {
  try {
    const parsed = new URL(url)
    return `${parsed.host}/…`
  } catch {
    return 'Link'
  }
}
