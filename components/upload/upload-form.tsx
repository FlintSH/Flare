'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import {
  AlertCircle,
  ChevronRight,
  Copy,
  EyeOff,
  Folder,
  MoreHorizontal,
  Plus,
  RotateCw,
  Share2,
  Upload,
} from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { copyText } from '@/lib/client/clipboard'
import { handOff, takeHandoff } from '@/lib/client/handoff'
import { apiRequest } from '@/lib/client/request'
import { folderDestination, libraryHref } from '@/lib/library/contract'
import { loneLink } from '@/lib/paste/insights'
import { expiryLabel, pinnedUploadOptions } from '@/lib/uploads/choices'
import { namePastedFile, pasteBelongsElsewhere } from '@/lib/uploads/clipboard'
import { type LinkFormat, formatLink } from '@/lib/uploads/link-formats'
import type { SavedUploadSettings } from '@/lib/uploads/saved-settings'
import { formatSpeed } from '@/lib/uploads/speed'
import type { TrayFile, TrayOutcome } from '@/lib/uploads/tray'
import { cn, formatBytes } from '@/lib/utils'

import { useHydrated } from '@/hooks/use-hydrated'
import { usePermissions } from '@/hooks/use-permissions'
import { useToast } from '@/hooks/use-toast'
import { useUploadTray } from '@/hooks/use-upload-tray'

import { LinkFormatMenu, useLinkFormat } from './link-format'
import { UploadOptionsBar } from './options-bar'
import { TrayRow } from './tray-row'
import { UploadTips, type UploadTipsShown } from './upload-tips'
import { useUploadOptions } from './use-upload-options'

const files = (count: number) => `${count} ${count === 1 ? 'file' : 'files'}`
const links = (count: number) => `${count} ${count === 1 ? 'link' : 'links'}`

/** "about 12 s left", "about 3 min left". */
function remaining(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  if (seconds < 60) return `about ${Math.max(1, Math.round(seconds))} s left`
  if (seconds < 3600) return `about ${Math.round(seconds / 60)} min left`
  return `about ${Math.round(seconds / 360) / 10} h left`
}

/** Where a field, a selection or an open dialog or menu owns a copy. */
function copyBelongsElsewhere(event: ClipboardEvent) {
  if (pasteBelongsElsewhere(event.target)) return true
  if (pasteBelongsElsewhere(document.activeElement)) return true
  // An open one: a menu still fading out after closing doesn't count.
  if (
    document.querySelector(
      ':is([role="dialog"], [role="alertdialog"], [role="menu"]):not([data-state="closed"])'
    )
  )
    return true
  const selection = window.getSelection()
  return !!selection && !selection.isCollapsed && !!selection.toString()
}

const textFileName = (file: TrayFile) => file.result?.name ?? file.name

/** The links of these files in a format, one per line. */
const textFor = (rows: readonly TrayFile[], format: LinkFormat) =>
  rows
    .filter((row) => row.result)
    .map((row) =>
      formatLink(format, {
        link: row.result!.link,
        name: textFileName(row),
        type: row.type,
      })
    )
    .join('\n')

/**
 * The Upload page. Files go up the moment they land, with the settings shown
 * above them, and each turns into its link. Ctrl/⌘+C copies the links of the
 * newest batch. The list lives for the tab, so leaving the page loses nothing.
 */
export function UploadForm({
  maxSize,
  saved,
  folder,
  tips: initialTips = null,
}: {
  maxSize: number
  saved: SavedUploadSettings
  /** The folder a link to Upload names, when it is the account's. */
  folder?: { id: string; name: string } | null
  /** The tips to show while nothing is listed, unless the account hid them. */
  tips?: UploadTipsShown | null
}) {
  const hydrated = useHydrated()
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const searchParams = useSearchParams()
  const requested = folderDestination(searchParams.get('folder'))
  const options = useUploadOptions(
    saved,
    requested
      ? {
          id: requested,
          name: folder?.id === requested ? folder.name : undefined,
        }
      : null
  )
  const { can } = usePermissions()
  const { tray, files: trayFiles, batch, pausedBy } = useUploadTray()
  const paused = pausedBy !== null
  const [format, setFormat] = useLinkFormat()
  const [refused, setRefused] = useState(0)
  const [copied, setCopied] = useState<ReadonlySet<number>>(new Set())
  const [deleting, setDeleting] = useState<TrayFile | null>(null)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const { toast } = useToast()
  const router = useRouter()
  const [tips, setTips] = useState(initialTips)

  // What a file dropped now is uploaded as, or why it has to wait.
  const settings = useMemo(():
    | { options: typeof options.options; outcome: TrayOutcome }
    | { held: string } => {
    if (options.problem) return { held: options.problem }
    if (options.pending) return { held: 'Checking the folder…' }
    const { effective, choices, can: allowed, profiles } = options
    // Visibility, expiration and tags are sent as they stand now, so a
    // profile or default changed while the file waits can't change them.
    // The profile goes by its ID: its naming and page style are read when
    // the file arrives.
    const profileId =
      allowed.chooseProfile && choices.profileId === undefined
        ? (profiles.data?.defaultProfileId ?? saved.profile?.id ?? null)
        : choices.profileId
    return {
      options: pinnedUploadOptions(
        { ...choices, profileId, password: options.options.password ?? '' },
        effective,
        { share: allowed.share, tag: allowed.tag }
      ),
      outcome: {
        visibility: effective.visibility,
        expires:
          effective.expiry.kind === 'never'
            ? null
            : expiryLabel(effective.expiry, effective.expiryAction),
        password: options.passwordSet,
        folder: options.folders.selected
          ? {
              id: options.folders.selected.id,
              name: options.folders.selected.name,
            }
          : null,
      },
    }
  }, [options, saved.profile])
  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings
  })

  const add = useCallback(
    (selected: readonly File[]) => {
      if (!selected.length) return
      setRefused(tray.add(selected, maxSize, settingsRef.current).length)
    },
    [tray, maxSize]
  )

  // Files handed over by Paste, where they were pasted.
  useEffect(() => {
    // Pasted on Paste: they wait here until the settings are seen.
    const handed = takeHandoff('files')
    if (handed)
      setRefused(
        tray.add(handed.files, maxSize, {
          held: 'Check the settings above, then upload.',
        }).length
      )
  }, [tray, maxSize])

  // Drop anywhere on the page.
  useEffect(() => {
    let depth = 0
    const carriesFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files')
    const enter = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      depth += 1
      setDragging(true)
    }
    const leave = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (!depth) setDragging(false)
    }
    const over = (event: DragEvent) => {
      if (carriesFiles(event)) event.preventDefault()
    }
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      depth = 0
      setDragging(false)
      add(Array.from(event.dataTransfer?.files ?? []))
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [add])

  // Ctrl/⌘+V adds copied files and screenshots; text and links are offered
  // to the tool they belong to.
  const canPaste = can('pastes.create')
  const canShorten = can('links.create')
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (pasteBelongsElsewhere(event.target)) return
      const pasted = Array.from(event.clipboardData?.files ?? [])
      if (pasted.length) {
        event.preventDefault()
        const now = new Date()
        add(pasted.map((file) => namePastedFile(file, now)))
        return
      }
      const text = event.clipboardData?.getData('text/plain') ?? ''
      if (!text.trim()) return
      const link = loneLink(text)
      if (link && canShorten) {
        event.preventDefault()
        toast({
          title: 'That’s a link, not a file',
          action: (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                handOff({ kind: 'link', url: link })
                router.push('/dashboard/urls')
              }}
            >
              Shorten it
            </Button>
          ),
        })
      } else if (!link && canPaste) {
        event.preventDefault()
        toast({
          title: 'That’s text, not a file',
          action: (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                handOff({ kind: 'text', text })
                router.push('/dashboard/paste')
              }}
            >
              Make a paste
            </Button>
          ),
        })
      }
    }
    document.addEventListener('paste', paste)
    return () => document.removeEventListener('paste', paste)
  }, [add, canPaste, canShorten, router, toast])

  const newest = trayFiles.filter((file) => file.batch === batch)
  const earlier = trayFiles.filter((file) => file.batch !== batch).reverse()
  const done = newest.filter((file) => file.result)
  const held = newest.filter((file) => file.status === 'held')
  const sending = newest.find((file) => file.status === 'sending')
  const failed = newest.find((file) => file.status === 'failed')
  const failedCount = newest.filter(({ status }) => status === 'failed').length
  const total = newest.reduce((sum, file) => sum + file.size, 0)
  const sent = newest.reduce(
    (sum, file) =>
      sum +
      (file.status === 'done'
        ? file.size
        : file.status === 'sending'
          ? file.uploaded
          : 0),
    0
  )
  const going = newest.some(
    ({ status }) => status === 'waiting' || status === 'sending'
  )

  // The tab says how far along it is, for someone working in another tab.
  useEffect(() => {
    if (!going || !total) return
    const title = document.title
    document.title = `${Math.min(99, Math.floor((sent / total) * 100))}% · ${title}`
    return () => {
      document.title = title
    }
  }, [going, sent, total])

  const flash = (keys: readonly number[]) => {
    setCopied(new Set(keys))
    setTimeout(() => {
      if (mounted.current)
        setCopied((current) =>
          keys.every((key) => current.has(key)) ? new Set() : current
        )
    }, 2000)
  }

  const copy = async (rows: readonly TrayFile[], as: LinkFormat = format) => {
    const ready = rows.filter((row) => row.result)
    if (!ready.length) return
    if (await copyText(textFor(ready, as))) {
      flash(ready.map((row) => row.key))
      toast({
        title: ready.length === 1 ? 'Copied' : `${links(ready.length)} copied`,
      })
    } else
      toast({
        variant: 'destructive',
        title: 'Couldn’t copy',
        description: 'Open the file to copy its address.',
      })
  }
  const formatRef = useRef(format)
  const flashRef = useRef(flash)
  useEffect(() => {
    formatRef.current = format
    flashRef.current = flash
  })

  // Copying with nothing selected (Ctrl/⌘+C, or Edit › Copy) copies the
  // newest batch's links.
  const [announcement, setAnnouncement] = useState('')
  useEffect(() => {
    const copying = (event: ClipboardEvent) => {
      if (!event.clipboardData || copyBelongsElsewhere(event)) return
      const state = tray.getState()
      const ready = state.files.filter(
        (file) => file.batch === state.batch && file.result
      )
      if (!ready.length) return
      event.preventDefault()
      event.clipboardData.setData(
        'text/plain',
        textFor(ready, formatRef.current)
      )
      flashRef.current(ready.map((row) => row.key))
      const said =
        ready.length === 1 ? 'Link copied' : `${links(ready.length)} copied`
      setAnnouncement(said)
      toast({ title: said })
    }
    document.addEventListener('copy', copying)
    return () => document.removeEventListener('copy', copying)
  }, [tray, toast])

  const share = async () => {
    const text = done.map((row) => row.result!.link).join('\n')
    try {
      await navigator.share(
        done.length === 1 ? { url: done[0]!.result!.link } : { text }
      )
    } catch {
      /* Closing the share sheet is not a failure. */
    }
  }

  const remove = async (file: TrayFile) => {
    const id = file.result?.id
    if (!id) return
    try {
      await apiRequest(`/api/files/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        fallback: 'The file could not be deleted.',
      })
      tray.remove(file.key)
      router.refresh()
      toast({ title: `Deleted ${textFileName(file)}` })
    } catch (failure) {
      toast({
        variant: 'destructive',
        title: 'Couldn’t delete the file',
        description:
          failure instanceof Error ? failure.message : 'Please try again.',
      })
    }
  }

  // The quick fix for a file that went up public by mistake.
  const makePrivate = async (rows: readonly TrayFile[]) => {
    const targets = rows.filter(
      (row) => row.result?.id && row.outcome?.visibility === 'PUBLIC'
    )
    let made = 0
    for (const row of targets) {
      try {
        await apiRequest(`/api/files/${encodeURIComponent(row.result!.id!)}`, {
          method: 'PATCH',
          body: { visibility: 'PRIVATE' },
          fallback: 'The file could not be made private.',
        })
        tray.amend(row.key, { visibility: 'PRIVATE' })
        made += 1
      } catch (failure) {
        toast({
          variant: 'destructive',
          title: `Couldn’t make ${textFileName(row)} private`,
          description:
            failure instanceof Error ? failure.message : 'Please try again.',
        })
        return
      }
    }
    if (made) {
      router.refresh()
      toast({
        title: made === 1 ? 'Made private' : `${files(made)} made private`,
        description: 'Only you can open them now.',
      })
    }
  }

  // Hidden at once and for good. If that can't be saved, the tips come back
  // rather than return unannounced on the next visit.
  const hideTips = async () => {
    const shown = tips
    setTips(null)
    try {
      await apiRequest('/api/profile/tips', {
        method: 'POST',
        body: { hide: 'upload' },
        fallback: 'Your choice could not be saved.',
      })
      // Going back to this page reuses what the server sent before.
      router.refresh()
    } catch (failure) {
      if (!mounted.current) return
      setTips(shown)
      toast({
        variant: 'destructive',
        title: 'Couldn’t hide the tips',
        description:
          failure instanceof Error ? failure.message : 'Please try again.',
      })
    }
  }

  const empty = trayFiles.length === 0
  const mac = hydrated && /Mac|iPhone|iPad/.test(navigator.userAgent)
  const copyKey = mac ? '⌘C' : 'Ctrl+C'
  const pasteKey = mac ? '⌘V' : 'Ctrl+V'
  const canShare = hydrated && typeof navigator.share === 'function'
  const canDelete = can('files.delete')
  const batchFolder = newest.find((file) => file.outcome?.folder)?.outcome
    ?.folder
  const finished = trayFiles.some(
    ({ status }) => status === 'done' || status === 'failed'
  )

  const waiting = newest.filter(({ status }) => status === 'waiting').length
  const status = held.length
    ? `${files(held.length)} waiting`
    : paused
      ? `Paused · ${waiting} waiting`
      : going
        ? [
            `Uploading ${Math.min(done.length + failedCount + 1, newest.length)} of ${newest.length}`,
            sending?.speed ? formatSpeed(sending.speed) : null,
            sending?.speed ? remaining((total - sent) / sending.speed) : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : failed
          ? `${done.length} of ${files(newest.length)} uploaded`
          : `${files(done.length)} uploaded · ${formatBytes(total)}`
  const publicDone = done.filter(
    (file) => file.outcome?.visibility === 'PUBLIC' && file.result?.id
  )

  const rowProps = (file: TrayFile) => ({
    file,
    format,
    copied: copied.has(file.key),
    onCopy: (as: LinkFormat) => void copy([file], as),
    onCancel: () => tray.cancel(file.key),
    onRetry: () => tray.retry(file.key),
    onRemove: () => tray.remove(file.key),
    onDelete:
      canDelete && file.result?.id ? () => setDeleting(file) : undefined,
    onMakePrivate:
      options.can.share &&
      file.result?.id &&
      file.outcome?.visibility === 'PUBLIC'
        ? () => void makePrivate([file])
        : undefined,
  })

  return (
    <div className="space-y-4">
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          add(Array.from(event.target.files ?? []))
          event.target.value = ''
        }}
      />
      <div
        className={cn(
          'overflow-hidden rounded-xl border bg-background/40 transition-[border-color,box-shadow] motion-reduce:transition-none',
          dragging &&
            'border-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.15)]'
        )}
      >
        <div className="border-b border-border/60 bg-muted/20 p-2.5 sm:p-3">
          <UploadOptionsBar state={options} passwordId="upload-password" />
        </div>

        {empty ? (
          <button
            type="button"
            onClick={() => input.current?.click()}
            aria-label="Choose files to upload"
            className={cn(
              'flex w-full flex-col items-center justify-center px-4 py-14 text-center outline-none transition-colors hover:bg-muted/20 focus-visible:bg-muted/20 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:py-20',
              dragging && 'bg-primary/5'
            )}
          >
            <span
              className={cn(
                'mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground transition-transform motion-reduce:transition-none',
                dragging && 'scale-110 bg-primary text-primary-foreground'
              )}
            >
              <Upload className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="text-balance text-base font-medium">
              {dragging ? (
                'Drop to upload'
              ) : (
                <>
                  <span className="[@media(pointer:coarse)]:hidden">
                    Drop files here or{' '}
                    <span className="text-primary underline underline-offset-4">
                      choose files
                    </span>
                  </span>
                  <span className="hidden [@media(pointer:coarse)]:inline">
                    Choose files
                  </span>
                </>
              )}
            </span>
            <span className="mt-1.5 max-w-md text-balance text-sm text-muted-foreground">
              They upload right away with the settings above, up to{' '}
              {formatBytes(maxSize)} each
              <span className="[@media(pointer:coarse)]:hidden">
                . Paste with {pasteKey}
              </span>
            </span>
          </button>
        ) : (
          <section aria-labelledby="upload-batch-heading">
            <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 pt-3 sm:px-4">
              <h2
                id="upload-batch-heading"
                className="min-w-0 text-sm tabular-nums text-muted-foreground"
              >
                {status}
              </h2>
              <p className="sr-only" aria-live="polite">
                {done.length
                  ? `${done.length} of ${files(newest.length)} uploaded`
                  : ''}
              </p>
              <p className="sr-only" aria-live="polite">
                {announcement}
              </p>
              <div className="flex flex-wrap items-center gap-1">
                {batchFolder && done.length > 0 && (
                  <Button asChild variant="ghost" size="sm">
                    <Link href={libraryHref({ folder: batchFolder.id })}>
                      <Folder className="h-4 w-4" aria-hidden="true" />
                      Open {batchFolder.name}
                    </Link>
                  </Button>
                )}
                {pausedBy !== null && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => tray.retry(pausedBy)}
                  >
                    <RotateCw className="h-4 w-4" aria-hidden="true" />
                    Resume
                  </Button>
                )}
                {held.length > 0 ? (
                  <Button
                    size="sm"
                    disabled={'held' in settings}
                    onClick={() => tray.release(settings)}
                  >
                    <Upload className="h-4 w-4" aria-hidden="true" />
                    Upload {files(held.length)}
                  </Button>
                ) : (
                  done.length > 0 && (
                    <>
                      <LinkFormatMenu format={format} onChange={setFormat} />
                      {canShare && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void share()}
                          className="[@media(pointer:fine)]:hidden"
                        >
                          <Share2 className="h-4 w-4" aria-hidden="true" />
                          Share
                        </Button>
                      )}
                      <Button size="sm" onClick={() => void copy(done)}>
                        <Copy className="h-4 w-4" aria-hidden="true" />
                        {/* While others still go, say how many are in. */}
                        {done.length < newest.length
                          ? `Copy ${done.length} of ${links(newest.length)}`
                          : done.length === 1
                            ? 'Copy'
                            : `Copy ${links(done.length)}`}
                        <kbd className="ml-1 hidden rounded border border-current/30 px-1 font-sans text-[11px] leading-4 opacity-70 [@media(pointer:fine)]:sm:inline">
                          {copyKey}
                        </kbd>
                      </Button>
                      {options.can.share && publicDone.length > 0 && (
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 data-[state=open]:bg-accent"
                              aria-label="More for these files"
                            >
                              <MoreHorizontal
                                className="h-4 w-4"
                                aria-hidden="true"
                              />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem
                              onSelect={() => void makePrivate(publicDone)}
                            >
                              <EyeOff className="h-4 w-4" aria-hidden="true" />
                              {publicDone.length === 1
                                ? 'Make private'
                                : `Make ${publicDone.length} private`}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </>
                  )
                )}
              </div>
            </div>
            <ul className="mx-3 mt-2 divide-y divide-border/70 overflow-hidden rounded-lg border sm:mx-4">
              {newest.map((file) => (
                <TrayRow key={file.key} {...rowProps(file)} />
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 sm:px-4">
              <button
                type="button"
                onClick={() => input.current?.click()}
                className={cn(
                  'flex items-center gap-2 rounded-md px-1 py-1 text-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
                  dragging ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span className="font-medium text-foreground">
                  {dragging ? 'Drop to upload' : 'Add files'}
                </span>
                <span className="[@media(pointer:coarse)]:hidden">
                  or drop them anywhere
                </span>
              </button>
              {finished && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => tray.clear()}
                  title="Uploaded files stay in your library"
                >
                  Clear list
                </Button>
              )}
            </div>
            {earlier.length > 0 && (
              <details className="group border-t border-border/60">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2.5 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4 [&::-webkit-details-marker]:hidden">
                  <ChevronRight
                    className="h-4 w-4 transition-transform group-open:rotate-90 motion-reduce:transition-none"
                    aria-hidden="true"
                  />
                  Earlier ({earlier.length})
                </summary>
                <ul className="mx-3 mb-3 divide-y divide-border/70 overflow-hidden rounded-lg border sm:mx-4">
                  {earlier.map((file) => (
                    <TrayRow key={file.key} {...rowProps(file)} />
                  ))}
                </ul>
              </details>
            )}
          </section>
        )}
      </div>

      {refused > 0 && (
        <p
          role="alert"
          className="flex items-start gap-2 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {refused === 1
            ? `One file is larger than ${formatBytes(maxSize)} and wasn’t added.`
            : `${refused} files are larger than ${formatBytes(maxSize)} and weren’t added.`}
        </p>
      )}

      {empty && tips && (
        <UploadTips shown={tips} onHide={() => void hideTips()} />
      )}

      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleting ? textFileName(deleting) : 'this file'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Its link stops working for everyone. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleting) void remove(deleting)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
