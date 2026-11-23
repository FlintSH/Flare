'use client'

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import Link from 'next/link'

import { FileType } from '@/types/components/file'
import { useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNowStrict } from 'date-fns'
import {
  ArrowUpRight,
  Check,
  Copy,
  Download,
  Globe,
  Loader2,
  Lock,
  ScanText,
  Trash2,
} from 'lucide-react'

import { isArchiveCandidate } from '@/components/archives/archive-utils'
import { fileActionAllowed } from '@/components/dashboard/file-card/actions'
import {
  ArchiveBrowserDialog,
  ExpiryModal,
  TagManager,
} from '@/components/dashboard/library-dialogs'
import { useFileActions } from '@/components/file/actions/use-file-actions'
import { FileTypeIcon } from '@/components/file/file-type-icon'
import { FileViewer } from '@/components/file/viewer/file-viewer'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import { LinkFormatMenu, useLinkFormat } from '@/components/upload/link-format'

import { copyText } from '@/lib/client/clipboard'
import { sheetNeighbor, viewImage } from '@/lib/client/file-sheet'
import { isEditable } from '@/lib/client/paste-claim'
import { RefusedRequest, apiRequest } from '@/lib/client/request'
import { fileKind, fileTypeDescription } from '@/lib/files/file-kind'
import { filePasswordHint } from '@/lib/files/password-policy'
import { fileUrls, thumbnailLoader } from '@/lib/files/urls'
import { folderPath } from '@/lib/folders/navigation'
import { libraryChanged, onLibraryChange } from '@/lib/library/changes'
import { libraryHref } from '@/lib/library/contract'
import { EXPIRY_EFFECTS, allows } from '@/lib/permissions/actions'
import {
  RELATIVE_EXPIRATIONS,
  type RelativeExpiration,
} from '@/lib/uploads/choices'
import { formatLink } from '@/lib/uploads/link-formats'
import { expirationDate } from '@/lib/uploads/schema'
import { uploadTray } from '@/lib/uploads/tray'
import { cn, formatFileSize } from '@/lib/utils'

import { useFolders } from '@/hooks/use-folders'
import { usePermissions } from '@/hooks/use-permissions'
import { useTags } from '@/hooks/use-tags'
import { useToast } from '@/hooks/use-toast'

const problem = (failure: unknown) =>
  failure instanceof RefusedRequest || failure instanceof Error
    ? failure.message
    : 'Please try again.'

/**
 * One file's home inside the app: its preview, its link, and every choice
 * about it as a control you can see and change, instead of a menu and a
 * dialog per setting. Opened from a card, Find, or anything just made.
 */
export function FileSheet({
  id,
  onClose,
  onStep,
}: {
  id: string
  onClose: () => void
  /** Opens another file in this sheet: the one before or after in Files. */
  onStep: (id: string) => void
}) {
  const [file, setFile] = useState<FileType | null>(null)
  // `missing` only when Flare answered that there's no such file of yours;
  // a request that failed keeps the file on screen, or offers to try again.
  // The answer belongs to the file it was for: stepping to another file is
  // "loading" from its first render, with the one before still shown.
  const [answer, setAnswer] = useState<{
    for: string
    state: 'loading' | 'ready' | 'missing' | 'failed'
  }>({ for: id, state: 'loading' })
  const status = answer.for === id ? answer.state : 'loading'
  // Only the newest request answers: a slow one for the file before, or a
  // refresh started earlier, never replaces it.
  const latestRequest = useRef(0)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const request = ++latestRequest.current
      try {
        const list = await apiRequest<FileType[]>(
          `/api/files?${new URLSearchParams({ ids: id, limit: '1' })}`,
          { signal }
        )
        if (signal?.aborted || request !== latestRequest.current) return
        // The file asked for, exactly (the list reads commas as several).
        const found = Array.isArray(list)
          ? list.find((entry) => entry.id === id)
          : undefined
        setFile(found ?? null)
        setAnswer({ for: id, state: found ? 'ready' : 'missing' })
      } catch (failure) {
        if (signal?.aborted || request !== latestRequest.current) return
        // Refused for what was asked (a malformed id): there's no such file.
        const refused =
          failure instanceof RefusedRequest &&
          failure.status >= 400 &&
          failure.status < 500 &&
          failure.status !== 429
        setAnswer({ for: id, state: refused ? 'missing' : 'failed' })
      }
    },
    [id]
  )
  // Stepping to another file keeps this one on screen until it arrives.
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])
  // A change made anywhere (a card, a dialog, another tab's action here)
  // shows here too.
  // Not once it's deleted from here: it's leaving, and there'd be nothing.
  const deleted = useRef(false)
  // Deleting was about the file shown then, not the one after it.
  useEffect(() => {
    deleted.current = false
  }, [id])
  useEffect(
    () =>
      onLibraryChange(() => {
        if (!deleted.current) void load()
      }),
    [load]
  )

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        // A light scrim, no blur: the page you came from stays in view.
        overlayClassName="bg-[color-mix(in_srgb,var(--scrim)_60%,transparent)] backdrop-blur-none"
        // The sheet itself takes focus, not its close button.
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
        tabIndex={-1}
        // Busy while the next file loads over the one before.
        aria-busy={status === 'loading'}
        // ← and → step through the library's files, outside fields.
        onKeyDown={(event) => {
          if (
            // Keys from its dialogs (portalled, but bubbling here in React)
            // belong to them.
            !event.currentTarget.contains(event.target as Node) ||
            (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') ||
            // A player that used the key (to seek) keeps it.
            event.defaultPrevented ||
            event.altKey ||
            event.metaKey ||
            event.ctrlKey ||
            // Extending a selection.
            event.shiftKey ||
            isEditable(event.target) ||
            // A player seeks with them, after this runs.
            (event.target as Element).closest?.(
              'video, audio, [role="slider"], [role="radiogroup"], [role="menu"], [data-inline-editor]'
            )
          )
            return
          const next = sheetNeighbor(id, event.key === 'ArrowLeft' ? -1 : 1)
          if (!next) return
          event.preventDefault()
          // The file being left goes inert and its controls away: focus
          // stays on the sheet, so the arrows keep stepping.
          event.currentTarget.focus()
          onStep(next)
        }}
        className="flex w-full flex-col gap-0 overflow-hidden p-0 outline-none sm:max-w-[30rem]"
      >
        {file &&
        (file.id === id ? status !== 'missing' : status === 'loading') ? (
          // While the next file loads, the one before stays in view but
          // can't be acted on: its controls would change the wrong file.
          <div className="contents" inert={file.id !== id}>
            <FileSheetBody
              key={file.id}
              file={file}
              onClose={onClose}
              onDeleted={() => {
                deleted.current = true
              }}
              onSaved={(saved) =>
                setFile((current) =>
                  current?.id === file.id ? { ...current, ...saved } : current
                )
              }
            />
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
            <SheetTitle className="text-base">
              {status === 'missing'
                ? 'This file isn’t here'
                : status === 'failed'
                  ? 'Couldn’t open it'
                  : 'Opening…'}
            </SheetTitle>
            <SheetDescription>
              {status === 'missing'
                ? 'It may have been deleted, or it belongs to another account.'
                : status === 'failed'
                  ? 'Flare didn’t answer. Check your connection and try again.'
                  : ' '}
            </SheetDescription>
            {status === 'failed' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  // The file before isn't shown again while this one retries.
                  if (file && file.id !== id) setFile(null)
                  setAnswer({ for: id, state: 'loading' })
                  void load()
                }}
              >
                Try again
              </Button>
            )}
            {status === 'loading' && (
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

/** One property: its name in a narrow column, its value and controls beside it. */
function Row({
  label,
  busy,
  children,
  below,
}: {
  label: string
  busy?: boolean
  children: ReactNode
  /** What opens under the row, across the sheet's width. */
  below?: ReactNode
}) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-3 px-5 py-2.5">
      <dt className="flex min-h-8 items-center [@media(pointer:coarse)]:min-h-11 gap-1.5 text-sm text-muted-foreground">
        {label}
        {busy && (
          <Loader2 className="h-3 w-3 animate-spin" aria-label="Saving" />
        )}
      </dt>
      <dd className="min-w-0">{children}</dd>
      {below && <dd className="col-span-2 min-w-0">{below}</dd>}
    </div>
  )
}

/** Two or more choices side by side, one of them on. */
function Segments<Value extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: Value | null
  options: readonly {
    value: Value
    label: string
    icon?: typeof Globe
    disabled?: boolean
  }[]
  onChange: (value: Value) => void
  disabled?: boolean
}) {
  const usable = options.filter((option) => !disabled && !option.disabled)
  // One stop on Tab, as a radio group: the chosen option (or the first).
  const stop = usable.some((option) => option.value === value)
    ? value
    : usable[0]?.value
  return (
    <div
      role="radiogroup"
      aria-label={label}
      // The arrows move between options; Space or Enter chooses one. Moving
      // alone changes nothing: here a choice can make a file public.
      onKeyDown={(event) => {
        const step =
          event.key === 'ArrowRight' || event.key === 'ArrowDown'
            ? 1
            : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
              ? -1
              : 0
        if (!step || usable.length < 2) return
        event.preventDefault()
        const buttons = [...event.currentTarget.querySelectorAll('button')]
        // From the option that has focus (else the chosen one).
        const focused =
          options[buttons.indexOf(event.target as HTMLButtonElement)]
        const at =
          usable.indexOf(focused) >= 0
            ? usable.indexOf(focused)
            : usable.findIndex((option) => option.value === value)
        const next =
          usable[(Math.max(at, 0) + step + usable.length) % usable.length]
        buttons[options.indexOf(next)]?.focus()
      }}
      className="flex flex-wrap gap-1 rounded-xl border border-border/40 bg-muted/60 p-1 dark:bg-muted/25"
    >
      {options.map((option) => {
        const on = option.value === value
        const Icon = option.icon
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={option.value === stop ? 0 : -1}
            disabled={disabled || option.disabled}
            onClick={() => !on && onChange(option.value)}
            className={cn(
              'inline-flex h-8 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-transparent px-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
              on &&
                'border-border bg-background text-foreground shadow-sm dark:border-border/60'
            )}
          >
            {Icon && (
              <Icon
                className={cn('h-3.5 w-3.5', on && 'text-primary')}
                aria-hidden="true"
              />
            )}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function FileSheetBody({
  file,
  onClose,
  onDeleted,
  onSaved,
}: {
  file: FileType
  onClose: () => void
  onDeleted: () => void
  /** What a save changed, shown before the reload confirms it. */
  onSaved: (saved: Partial<FileType>) => void
}) {
  const { user } = usePermissions()
  const { toast } = useToast()
  const client = useQueryClient()
  const { folders } = useFolders()
  const { tags } = useTags()
  const [format, setFormat] = useLinkFormat()
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(copiedTimer.current), [])
  const [busy, setBusy] = useState<string | null>(null)
  const [password, setPassword] = useState<string | null>(null)
  // A still picture is shown at the sheet's size, not downloaded whole for
  // each step; an animation or a drawing is shown as it is. The original
  // when the smaller copy can't be made.
  const sized = /^image\/(jpeg|png|webp|avif|heic|heif|tiff|bmp)$/.test(
    file.mimeType
  )
  const [sizedFailed, setSizedFailed] = useState<string | null>(null)
  const [managingTags, setManagingTags] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [pickingDate, setPickingDate] = useState(false)
  const [choosingExpiry, setChoosingExpiry] = useState(false)
  // The choices open in full view, above the footer pinned under them.
  const expiryChoices = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (choosingExpiry)
      expiryChoices.current?.scrollIntoView({ block: 'nearest' })
  }, [choosingExpiry])
  const kind = fileKind(file)
  const urls = fileUrls(file)
  const can = (id: Parameters<typeof fileActionAllowed>[1]) =>
    fileActionAllowed(user, id)
  // Every open library reloads, this sheet included.
  const changed = () => libraryChanged(client)
  const actions = useFileActions(file, {
    ocr: true,
    onDelete: () => {
      onDeleted()
      // Upload's list no longer offers a link that's gone.
      uploadTray().forgetFile(file.id)
      void libraryChanged(client)
      onClose()
    },
  })

  // A save that went through shows at once, from what was saved, even if
  // the reload after it fails; `work` answers with what changed.
  const running = useRef(false)
  const run = async (
    key: string,
    work: () => Promise<Partial<FileType> | void>,
    done: string
  ) => {
    // A ref as well as the state: two clicks in one frame both see `busy`
    // unset, but not this.
    if (busy || running.current) return
    running.current = true
    setBusy(key)
    try {
      const saved = await work()
      if (saved) onSaved(saved)
      // The lists elsewhere catch up in the background; this sheet already
      // shows what was saved, so it doesn't wait for them.
      void changed()
      toast({ title: done })
      return true
    } catch (failure) {
      toast({
        title: 'That didn’t save',
        description: problem(failure),
        variant: 'destructive',
      })
      return false
    } finally {
      running.current = false
      setBusy(null)
    }
  }
  const patch = (key: string, body: object, done: string) =>
    run(
      key,
      async () => {
        const updated = await apiRequest<
          Pick<FileType, 'visibility' | 'hasPassword'>
        >(`/api/files/${file.id}`, {
          method: 'PATCH',
          body,
          fallback: 'Please try again.',
        })
        return {
          visibility: updated.visibility,
          hasPassword: updated.hasPassword,
        }
      },
      done
    )

  const link = fileUrls(file, {
    origin: typeof window === 'undefined' ? '' : window.location.origin,
  }).page
  const copyLink = async () => {
    const text = formatLink(format, {
      link,
      name: file.name,
      type: file.mimeType,
    })
    if (await copyText(text)) {
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
  }

  // One Date per value: the date dialog resets to it whenever it changes.
  const expires = useMemo(
    () => (file.expiresAt ? new Date(file.expiresAt) : null),
    [file.expiresAt]
  )
  const expiryAction = file.expiryAction ?? 'DELETE'
  const canExpire = can('expiration')
  const canAct = (action: 'DELETE' | 'SET_PRIVATE') =>
    allows(user, EXPIRY_EFFECTS[action])
  // What expiring does, chosen before or after the time: the file's own
  // choice, or the one this account may make.
  // A set expiry keeps its outcome chosen, even one the role may no longer
  // pick; a new one starts on what the role may.
  const savedThen: 'DELETE' | 'SET_PRIVATE' =
    expires || canAct(expiryAction)
      ? expiryAction
      : expiryAction === 'DELETE'
        ? 'SET_PRIVATE'
        : 'DELETE'
  const [then, setThen] = useState(savedThen)
  // Closing the choices puts focus back on Change; after a save, once it
  // has finished, as Change waits (disabled) while one runs.
  const focusExpiryTrigger = () =>
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>('[data-edit-trigger="expiry"]')
        ?.focus()
    )
  const closeExpiry = () => {
    setChoosingExpiry(false)
    focusExpiryTrigger()
  }
  // Closing the choices without saving drops an outcome chosen in them, and
  // a save shows what was saved.
  useEffect(() => {
    if (!choosingExpiry) setThen(savedThen)
  }, [choosingExpiry, savedThen])
  const setExpiry = (at: Date | null, action = expiryAction) =>
    run(
      'expiry',
      async () => {
        await apiRequest(`/api/files/${file.id}/expiry`, {
          ...(at
            ? { body: { expiresAt: at.toISOString(), action } }
            : { method: 'DELETE' }),
          fallback: 'Please try again.',
        })
        return at
          ? {
              expiresAt: at.toISOString(),
              expiryAction: action as FileType['expiryAction'],
            }
          : { expiresAt: null }
      },
      at ? 'Expiration set' : 'It no longer expires'
    )
  const folder = folders.find(({ id }) => id === file.folderId)
  const move = (folderId: string | null) =>
    run(
      'move',
      async () => {
        await apiRequest('/api/files/folders', {
          body: { fileIds: [file.id], folderId },
          fallback: 'Please try again.',
        })
        return { folderId }
      },
      folderId
        ? `Moved to ${folders.find(({ id }) => id === folderId)?.name ?? 'the folder'}`
        : 'Moved to Unfiled'
    )
  const retag = (tagId: string, action: 'add' | 'remove') =>
    run(
      'tags',
      async () => {
        await apiRequest('/api/files/tags', {
          method: 'PATCH',
          body: { fileIds: [file.id], tagId, action },
          fallback: 'Please try again.',
        })
        // The file's tags as they now are, shown before the reload.
        const current = file.tags ?? []
        const tag = tags.find(({ id }) => id === tagId)
        return {
          tags:
            action === 'add'
              ? tag && !current.some(({ id }) => id === tagId)
                ? [...current, { id: tag.id, name: tag.name }]
                : current
              : current.filter(({ id }) => id !== tagId),
        }
      },
      action === 'add' ? 'Tag added' : 'Tag removed'
    )
  const passwordHint = password ? filePasswordHint(password) : null
  // Closing the field puts focus back on the button that opened it.
  const closePassword = () => {
    setPassword(null)
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>('[data-edit-trigger="password"]')
        ?.focus()
    )
  }

  return (
    <>
      <header className="flex items-start gap-3 px-5 pb-4 pt-5 pr-14">
        <div className="min-w-0 flex-1">
          <SheetTitle
            className="line-clamp-2 break-words text-base font-semibold leading-snug [overflow-wrap:anywhere]"
            title={file.name}
          >
            {file.name}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {fileTypeDescription(file)} · {formatFileSize(file.size)} ·{' '}
            {formatDistanceToNowStrict(new Date(file.uploadedAt), {
              addSuffix: true,
            })}
          </SheetDescription>
        </div>
      </header>

      {/* The header and footer stay; what is between them scrolls. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative shrink-0">
          <div className="max-h-[27dvh] min-h-24 shrink-0 overflow-auto border-y border-border/60 bg-muted/20 sm:max-h-[42dvh]">
            {kind.kind === 'archive' ||
            kind.kind === 'other' ||
            kind.kind === 'unsupported-archive' ? (
              <div className="flex flex-col items-center gap-3 p-8">
                <FileTypeIcon
                  file={file}
                  className="h-10 w-10 text-muted-foreground"
                />
                {isArchiveCandidate(file.name, file.mimeType) &&
                  can('browseArchive') && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        ArchiveBrowserDialog.show(() => setBrowsing(true))
                      }
                    >
                      Browse archive
                    </Button>
                  )}
              </div>
            ) : kind.kind === 'image' ? (
              // The whole picture, fitted, rather than the share page's frame.
              // The content route, which counts no view: looking at your own
              // file isn't a visit. Its one action sits on its corner.
              <div className="relative mx-auto w-fit max-w-full">
                <a
                  href={urls.content}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="View full size"
                  // In the library, its viewer, which steps through the images.
                  onClick={(event) => {
                    if (
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    )
                      return
                    if (viewImage(file)) event.preventDefault()
                  }}
                >
                  <img
                    src={
                      sized && sizedFailed !== file.id
                        ? thumbnailLoader({ src: urls.thumbnail, width: 960 })
                        : urls.content
                    }
                    onError={() => {
                      if (sized) setSizedFailed(file.id)
                    }}
                    alt={file.name}
                    className="mx-auto max-h-[27dvh] w-auto max-w-full object-contain sm:max-h-[42dvh]"
                  />
                </a>
                {actions.offered('ocr') && (
                  // What you can do with the picture, on it.
                  <Button
                    variant="secondary"
                    size="sm"
                    className="absolute bottom-2 right-2 h-8 shadow-sm"
                    disabled={actions.ocrBusy}
                    onClick={actions.offered('ocr')?.run}
                  >
                    <ScanText className="h-4 w-4" aria-hidden="true" />
                    {actions.ocrBusy ? 'Extracting text…' : 'Extract text'}
                  </Button>
                )}
              </div>
            ) : (
              <FileViewer
                ownView
                file={{
                  id: file.id,
                  name: file.name,
                  urlPath: file.urlPath,
                  mimeType: file.mimeType,
                  visibility: file.visibility,
                  size: Math.round(file.size * 1024 * 1024),
                  ...kind,
                }}
              />
            )}
          </div>
        </div>

        {can('copyLink') && (
          <div className="flex items-center gap-2 px-5 py-4">
            <code
              className="min-w-0 flex-1 truncate rounded-lg border border-border/60 bg-background/60 px-3 py-2 font-mono text-xs text-muted-foreground"
              title={link}
            >
              {/* On a phone the path, which tells files apart, gets the room. */}
              <span className="max-sm:hidden">
                {link.replace(/^https?:\/\//, '').split('/')[0]}
              </span>
              {link.replace(/^https?:\/\/[^/]+/, '')}
            </code>
            <Button size="sm" className="h-9" onClick={() => void copyLink()}>
              {copied ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <LinkFormatMenu
              format={format}
              onChange={(next) => {
                setFormat(next)
                setCopied(false)
              }}
            />
          </div>
        )}

        <dl className="divide-y divide-border/60 border-t border-border/60">
          <Row label="Access" busy={busy === 'visibility'}>
            <Segments
              label="Who can open it"
              value={file.visibility}
              disabled={!can('visibility') || !!busy}
              options={[
                { value: 'PUBLIC', label: 'Public', icon: Globe },
                { value: 'PRIVATE', label: 'Private', icon: Lock },
              ]}
              onChange={(visibility) =>
                void patch(
                  'visibility',
                  { visibility },
                  visibility === 'PUBLIC' ? 'Now public' : 'Now private'
                )
              }
            />
          </Row>

          {/* A private file keeps the row while it has a password to remove. */}
          {(file.visibility === 'PUBLIC' || file.hasPassword) &&
            can('password') && (
              <Row label="Password" busy={busy === 'password'}>
                {password === null ? (
                  <div className="flex min-h-8 items-center [@media(pointer:coarse)]:min-h-11 gap-1 text-sm">
                    <span className="flex-1 text-muted-foreground">
                      {file.hasPassword ? 'Required' : 'None'}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8"
                      data-edit-trigger="password"
                      disabled={!!busy}
                      onClick={() => setPassword('')}
                    >
                      {file.hasPassword ? 'Change' : 'Add'}
                    </Button>
                    {file.hasPassword && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-muted-foreground"
                        disabled={!!busy}
                        onClick={() =>
                          void patch(
                            'password',
                            { password: null },
                            'Password removed'
                          )
                        }
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                ) : (
                  <form
                    data-inline-editor
                    // Esc anywhere in the field (its buttons too) closes it.
                    onKeyDown={(event) => {
                      if (event.key !== 'Escape') return
                      event.stopPropagation()
                      // Not while it saves: a failed save keeps the field.
                      if (!busy) closePassword()
                    }}
                    className="space-y-1"
                    onSubmit={(event) => {
                      event.preventDefault()
                      if (!password || passwordHint) return
                      // A failed save keeps the field and what's in it.
                      void patch('password', { password }, 'Password set').then(
                        (saved) => saved && closePassword()
                      )
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Input
                        type="password"
                        autoFocus
                        autoComplete="new-password"
                        aria-label="New password"
                        readOnly={!!busy}
                        placeholder="New password"
                        value={password}
                        aria-invalid={Boolean(passwordHint)}
                        aria-describedby={
                          passwordHint ? 'password-hint' : undefined
                        }
                        onChange={(event) => setPassword(event.target.value)}
                        className="h-8 min-w-0 flex-1"
                      />
                      <Button
                        type="submit"
                        size="sm"
                        className="h-8"
                        disabled={!password || Boolean(passwordHint) || !!busy}
                      >
                        Save
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8"
                        disabled={!!busy}
                        onClick={closePassword}
                      >
                        Cancel
                      </Button>
                    </div>
                    {passwordHint && (
                      <p
                        id="password-hint"
                        role="alert"
                        className="text-xs text-destructive"
                      >
                        {passwordHint}
                      </p>
                    )}
                  </form>
                )}
              </Row>
            )}

          {canExpire && (
            <Row
              label="Expires"
              busy={busy === 'expiry'}
              // The choices open in place under the row, across the sheet, so
              // nothing covers the rows and actions below.
              below={
                choosingExpiry && (
                  <div
                    ref={expiryChoices}
                    data-inline-editor
                    onKeyDown={(event) => {
                      if (event.key !== 'Escape') return
                      event.stopPropagation()
                      if (!busy) closeExpiry()
                    }}
                    className="scroll-mb-24 space-y-3 rounded-lg bg-muted/40 p-3 dark:bg-muted/20"
                  >
                    <div className="border-b border-border/60 pb-3">
                      <Segments
                        label="When it expires"
                        value={then}
                        disabled={!!busy}
                        options={[
                          {
                            value: 'DELETE',
                            label: 'Then delete',
                            disabled: !canAct('DELETE'),
                          },
                          {
                            value: 'SET_PRIVATE',
                            label: 'Then make private',
                            disabled: !canAct('SET_PRIVATE'),
                          },
                        ]}
                        // Chosen with the time it goes with: a time saves both,
                        // and Done keeps it for the deadline already set.
                        onChange={setThen}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {[
                        { value: 'never', label: 'Never' },
                        ...RELATIVE_EXPIRATIONS,
                        { value: 'custom', label: 'Date…' },
                      ].map(({ value, label }) => (
                        <Button
                          key={value}
                          variant={
                            value === 'never' && !expires
                              ? 'secondary'
                              : 'outline'
                          }
                          size="sm"
                          className="h-8"
                          disabled={
                            !!busy || (value !== 'never' && !canAct(then))
                          }
                          onClick={() => {
                            if (value === 'custom')
                              return ExpiryModal.show(() =>
                                setPickingDate(true)
                              )
                            if (value === 'never' && !expires)
                              return closeExpiry()
                            // Counted as uploads count it (a calendar month,
                            // not 30 days).
                            const at =
                              value === 'never'
                                ? null
                                : expirationDate(
                                    value as RelativeExpiration,
                                    new Date()
                                  )
                            if (value !== 'never' && !at) return
                            // The choices stay open if it didn't save.
                            void setExpiry(at ? new Date(at) : null, then).then(
                              (saved) => saved && closeExpiry()
                            )
                          }}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                  </div>
                )
              }
            >
              <div>
                <div className="flex min-h-8 items-center [@media(pointer:coarse)]:min-h-11 gap-1 text-sm">
                  <span
                    className={cn(
                      'flex-1',
                      expires ? 'text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    {expires
                      ? `${expiryAction === 'SET_PRIVATE' ? 'Goes private' : 'Deleted'} ${formatDistanceToNowStrict(
                          expires,
                          { addSuffix: true }
                        )}`
                      : 'Never'}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    disabled={!!busy}
                    aria-expanded={choosingExpiry}
                    data-edit-trigger="expiry"
                    onClick={async () => {
                      // Save keeps the choices open if it didn't save.
                      if (choosingExpiry && expires && then !== expiryAction) {
                        if (await setExpiry(expires, then)) closeExpiry()
                        return
                      }
                      if (choosingExpiry) closeExpiry()
                      else setChoosingExpiry(true)
                    }}
                  >
                    {/* Save while a new outcome waits for the deadline already set. */}
                    {!choosingExpiry
                      ? 'Change'
                      : expires && then !== expiryAction
                        ? 'Save'
                        : 'Done'}
                  </Button>
                </div>
              </div>
            </Row>
          )}

          <Row label="Folder" busy={busy === 'move'}>
            <div className="flex min-h-8 items-center [@media(pointer:coarse)]:min-h-11 gap-1 text-sm">
              <Link
                href={libraryHref({ folder: file.folderId ?? 'unfiled' })}
                className="flex-1 truncate underline-offset-4 hover:underline"
              >
                {folder?.name ?? 'Unfiled'}
              </Link>
              {can('move') && (
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8"
                      disabled={!!busy}
                    >
                      Move
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="max-h-[min(20rem,var(--radix-dropdown-menu-content-available-height))] w-64 overflow-y-auto"
                  >
                    <DropdownMenuRadioGroup
                      value={file.folderId ?? ''}
                      onValueChange={(value) => void move(value || null)}
                    >
                      <DropdownMenuRadioItem value="">
                        Unfiled
                      </DropdownMenuRadioItem>
                      {[...folders]
                        .sort((a, b) =>
                          folderPath(folders, a.id).localeCompare(
                            folderPath(folders, b.id)
                          )
                        )
                        .map((entry) => (
                          <DropdownMenuRadioItem
                            key={entry.id}
                            value={entry.id}
                          >
                            <span className="min-w-0 truncate">
                              {folderPath(folders, entry.id)}
                            </span>
                          </DropdownMenuRadioItem>
                        ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </Row>

          <Row label="Tags" busy={busy === 'tags'}>
            <div className="flex min-h-8 flex-wrap items-center [@media(pointer:coarse)]:min-h-11 gap-1.5 text-sm">
              {(file.tags ?? []).length ? (
                file.tags!.map((tag) => (
                  <Link
                    key={tag.id}
                    href={libraryHref({ tag: tag.id })}
                    className="rounded-md border border-border/60 bg-muted/70 px-1.5 py-0.5 text-xs hover:bg-muted"
                  >
                    {tag.name}
                  </Link>
                ))
              ) : (
                <span className="text-muted-foreground">None</span>
              )}
              {can('editTags') && (
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-8"
                      disabled={!!busy}
                    >
                      {(file.tags ?? []).length ? 'Edit' : 'Add'}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="max-h-[min(20rem,var(--radix-dropdown-menu-content-available-height))] w-60 overflow-y-auto"
                  >
                    {tags.map((tag) => {
                      const on = (file.tags ?? []).some(
                        ({ id }) => id === tag.id
                      )
                      return (
                        <DropdownMenuCheckboxItem
                          key={tag.id}
                          checked={on}
                          // One change at a time: a tick during a save
                          // would be lost, so it waits for it.
                          disabled={!!busy}
                          // Stays open, so several can change at once.
                          onSelect={(event) => event.preventDefault()}
                          onCheckedChange={() =>
                            void retag(tag.id, on ? 'remove' : 'add')
                          }
                        >
                          <span className="min-w-0 truncate">{tag.name}</span>
                        </DropdownMenuCheckboxItem>
                      )
                    })}
                    {tags.length > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuItem
                      onSelect={() =>
                        TagManager.show(() => setManagingTags(true))
                      }
                    >
                      {tags.length ? 'Manage tags…' : 'New tag…'}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </Row>

          <Row label="Activity">
            <p className="flex min-h-8 items-center [@media(pointer:coarse)]:min-h-11 text-sm tabular-nums text-muted-foreground">
              {file.views.toLocaleString()}{' '}
              {file.views === 1 ? 'view' : 'views'} ·{' '}
              {file.downloads.toLocaleString()}{' '}
              {file.downloads === 1 ? 'download' : 'downloads'}
            </p>
          </Row>
        </dl>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border/60 bg-overlay px-5 py-4">
        <Button variant="outline" size="sm" asChild>
          <a href={urls.page} target="_blank" rel="noopener noreferrer">
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            Share page
          </a>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={urls.download} download={file.name}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Download
          </a>
        </Button>
        {actions.offered('delete') && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-destructive hover:bg-danger/10 hover:text-destructive"
            onClick={actions.offered('delete')?.run}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Delete
          </Button>
        )}
      </footer>

      {actions.dialogs}
      {pickingDate && (
        <ExpiryModal
          isOpen
          onOpenChange={setPickingDate}
          onConfirm={async (date, action) => {
            // The dialog's answer is the whole choice: once saved, the sheet
            // shows it and closes its editor, so Done can't save an older
            // outcome. If it isn't saved, the dialog stays with the date.
            const chosen = (action as typeof expiryAction) ?? then
            if (!(await setExpiry(date, chosen)))
              throw new Error('The expiry wasn’t saved.')
            setThen(chosen)
            setPickingDate(false)
            closeExpiry()
          }}
          initialDate={expires}
          initialAction={then as never}
          title="Choose when it expires"
          description="Pick a date and time, and what happens then."
        />
      )}
      {managingTags && (
        <TagManager
          open
          onOpenChange={setManagingTags}
          onDeleted={() => void changed()}
        />
      )}
      {browsing && (
        <ArchiveBrowserDialog file={file} onClose={() => setBrowsing(false)} />
      )}
    </>
  )
}
