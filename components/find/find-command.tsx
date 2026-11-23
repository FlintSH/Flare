'use client'

import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { FileType } from '@/types/components/file'
import { Command } from 'cmdk'
import { formatDistanceToNowStrict } from 'date-fns'
import {
  AlertCircle,
  ArrowRight,
  FileText,
  Folder,
  Link as LinkIcon,
  Loader2,
  Moon,
  Search,
  Settings2,
  ShieldAlert,
  Sun,
  Upload,
  Wrench,
} from 'lucide-react'
import { useTheme } from 'next-themes'

import { PERSONAL_APPEARANCE } from '@/components/customization/appearance-provider'
import { FileTypeIcon } from '@/components/file/file-type-icon'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ToastAction } from '@/components/ui/toast'

import { copyText } from '@/lib/client/clipboard'
import { openFileSheet, openLinkSheet } from '@/lib/client/file-sheet'
import {
  SEARCHABLE_MAX,
  asLink,
  linkCarriesCredential,
  searchHold,
  shortenAndCopy,
} from '@/lib/client/give'
import { handOff } from '@/lib/client/handoff'
import { apiRequest } from '@/lib/client/request'
import { hasThumbnail } from '@/lib/files/file-kind'
import { fileUrls, thumbnailLoader } from '@/lib/files/urls'
import { libraryHref } from '@/lib/library/contract'
import { shortLinkUrl } from '@/lib/links/schema'
import {
  type InstanceFeatures,
  type Place,
  matchPlaces,
  normalizeQuery,
  placesFor,
} from '@/lib/navigation/places'
import { allows } from '@/lib/permissions/actions'
import { FIND_LIMIT, type FindResults } from '@/lib/search/contract'
import { cn, formatFileSize } from '@/lib/utils'

import { useAccountRefresh } from '@/hooks/use-account-query'
import { usePermissions } from '@/hooks/use-permissions'
import { useToast } from '@/hooks/use-toast'

const DEBOUNCE_MS = 150

/** A button inside Find keeps Enter and Space, which cmdk would take. */
const ownKeys = (event: KeyboardEvent<HTMLButtonElement>) => {
  if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
}

/** The search a result was last opened from, for Find's next opening. */
let lastFind: {
  query: string
  row: string
  at: number
  /** Whose: another account signed in in this tab doesn't get it. */
  user: string | undefined
} | null = null
/** How long Find remembers it: long enough to look at the next match. */
const RESUME_MS = 5 * 60_000
/** Remembers the search a result was opened from, for Find's next opening. */
function rememberFind(query: string, row: string, user: string | undefined) {
  lastFind = { query, row, at: Date.now(), user }
}
const readable = (url: string) => url.replace(/^https?:\/\//, '')

type Search =
  | { state: 'idle' }
  | { state: 'loading'; query: string; previous: FindResults | null }
  | { state: 'done'; query: string; results: FindResults }
  | { state: 'failed'; query: string }

interface Row {
  value: string
  icon: ReactNode
  title: string
  meta?: string
  /** What Enter does. */
  run: () => void | Promise<void>
  /** What ⌘/Ctrl+Enter copies. */
  copy?: string
  /** An answer to earlier words, shown until the new one comes, not chosen. */
  stale?: boolean
  hint?: string
}

/**
 * Find: every page and setting, and your files, links and folders, from one
 * field. Typed words are searched once they could mean something; pasted
 * secrets, links and long text never are.
 */
/** The page each "do" row opens, so it isn't listed twice. */
const DO_PAGES: Record<string, string> = {
  'do:upload': '/dashboard/upload',
  'do:paste': '/dashboard/paste',
  'do:shorten': '/dashboard/urls',
}

export function FindCommand({
  layout,
  onClose,
  features,
  onManageTags,
}: {
  /** In the bar on wide screens; the whole screen on phones. */
  layout: 'bar' | 'screen'
  /** `false` when Find closes because you went somewhere or clicked away: focus stays where you went. */
  onClose: (restoreFocus?: boolean) => void
  features: InstanceFeatures
  /** Opens the tag manager, which Find's wrapper holds. */
  onManageTags: () => void
}) {
  const onOpenChange = (open: boolean) => {
    if (!open) onClose(false)
  }
  const router = useRouter()
  const { toast } = useToast()
  const { user, can } = usePermissions()
  const { resolvedTheme } = useTheme()
  const refreshAppearance = useAccountRefresh(PERSONAL_APPEARANCE)
  const pathname = usePathname()
  // On Files the bar is the library's search: what you type filters it.
  const onFiles = pathname === libraryHref()
  // Opened again after showing a result, Find comes back to that search with
  // the result chosen, so the next match is a key away. Once.
  // Read here, cleared once mounted (not in the initializer, which React
  // may run twice).
  const [resumed] = useState(() => {
    const last = lastFind
    // A search Files is already showing wins over the one remembered, and
    // the bar on Files is the library's search, not a place to resume one.
    const kept =
      onFiles &&
      (layout === 'bar' ||
        new URLSearchParams(window.location.search).get('search'))
    return last &&
      !kept &&
      last.user === user?.id &&
      Date.now() - last.at < RESUME_MS
      ? last
      : null
  })
  useEffect(() => {
    lastFind = null
  }, [])
  // Until you type, what Find opened with filters nothing new.
  const [edited, setEdited] = useState(false)
  const [startingQuery] = useState(
    () =>
      resumed?.query ??
      (onFiles ? new URLSearchParams(window.location.search).get('search') : '')
  )
  const [query, setQuery] = useState(
    () =>
      resumed?.query ??
      (onFiles
        ? (new URLSearchParams(window.location.search).get('search') ?? '')
        : '')
  )
  const [selected, setSelected] = useState(resumed?.row ?? '')
  const input = useRef<HTMLInputElement>(null)
  const selectedOnFocus = useRef(false)
  useEffect(() => {
    // Whatever Find opens with (a resumed or kept search) is selected, so
    // typing starts a new search and → refines it.
    input.current?.select()
  }, [])
  // The library's search when Find opened, put back if Find leaves Files.
  const [startingSearch] = useState(() =>
    onFiles ? new URLSearchParams(window.location.search).get('search') : null
  )
  // Enter pressed while the words were still being searched: it runs the
  // first row of their answer, not of the one before.
  const [enterWaiting, setEnterWaiting] = useState(false)
  // A row chosen with the arrows or pointer is what Enter runs, loading or not.
  const [picked, setPicked] = useState(false)
  // In the bar on Files, what you type filters the grid below as you type.
  const filtering = onFiles && layout === 'bar'
  // A folder or filter hides the rest of the library from the grid, so Find
  // lists matching files from everywhere as well.
  const params = useSearchParams()
  const narrowed =
    onFiles &&
    [...params.keys()].some(
      (key) => !['search', 'sortBy', 'file', 'link'].includes(key)
    )
  const [search, setSearch] = useState<Search>({ state: 'idle' })
  const [retry, setRetry] = useState(0)
  const [announcement, setAnnouncement] = useState('')
  const [busy, setBusy] = useState(false)
  const shortening = useRef(false)
  const places = useMemo(() => placesFor(user, features), [user, features])
  const root = useRef<HTMLDivElement>(null)
  // Once per change of words: a long paste is scanned once, not per render.
  const { reason, secret: heldTextSecret } = useMemo(
    () => searchHold(query),
    [query]
  )
  const trimmed = query.trim()
  const privatePaste = allows(user, 'createPaste') && allows(user, 'shareFiles')
  // A credential link this role can't hand to Links: said so, not dropped
  // (and offered as a private paste where that's allowed).
  const linkNoted =
    reason === 'link' &&
    Boolean(linkCarriesCredential(asLink(trimmed) ?? '')) &&
    !(can('links.create') && allows(user, 'viewLinks'))

  // Typed words filter the library after a pause; anything Find would not
  // send (a secret, a link, long text) never reaches its address.
  const searchWords = reason && reason !== 'short' ? '' : trimmed
  const applySearch = useCallback(
    (words: string = searchWords) => {
      const params = new URLSearchParams(window.location.search)
      if ((params.get('search') ?? '') === words) return
      if (words) params.set('search', words)
      else params.delete('search')
      const next = params.toString()
      // At once (state of our own, which the App Router takes in), so a
      // click that comes right after sees the library's new search.
      window.history.replaceState(
        null,
        '',
        next ? `${pathname}?${next}` : pathname
      )
    },
    [searchWords, pathname]
  )
  useEffect(() => {
    // Typing a link, long text or a secret is for an action, not a search:
    // the library keeps its current search meanwhile.
    // Full screen covers the grid: its search applies when chosen (Show
    // matching files), so closing Find leaves the library as it was.
    // Not while an action runs (the theme switch): it put the search back.
    if (!onFiles || layout !== 'bar' || !edited || busy) return
    if (reason && reason !== 'short') {
      // Words already applied before the text turned into a secret, a link
      // or long text come out of the address again.
      applySearch(startingSearch ?? '')
      return
    }
    const timer = setTimeout(() => applySearch(), 250)
    return () => clearTimeout(timer)
  }, [onFiles, layout, edited, busy, reason, applySearch, startingSearch])

  // In the bar, a click anywhere else puts Find away. On Files the words
  // typed are the library's search at once (not after the pause), so what
  // a click leaves doesn't depend on how fast it came.
  const keepWords =
    onFiles && layout === 'bar' && edited && (!reason || reason === 'short')
  // However Find closes on Files without going anywhere (a click away, ⌘K,
  // Close), the words typed are the library's search, not left to the pause.
  const leaving = useRef(false)
  const flush = useRef<() => void>(() => {})
  useEffect(() => {
    flush.current = () => {
      if (!leaving.current && keepWords) applySearch()
    }
  })
  useEffect(() => () => flush.current(), [])
  useEffect(() => {
    if (layout !== 'bar') return
    const away = (target: EventTarget | null) => {
      if (root.current?.contains(target as Node)) return
      // Not after an action put the search back (or while one runs).
      if (keepWords && !leaving.current && !busy) applySearch()
      onClose(false)
    }
    const outside = (event: PointerEvent) => away(event.target)
    // Tabbing out puts it away too. Focus going nowhere (the window losing
    // it, a click on the page) is left to the pointer.
    const left = (event: FocusEvent) => {
      if (event.relatedTarget) away(event.relatedTarget)
    }
    const field = root.current
    document.addEventListener('pointerdown', outside)
    field?.addEventListener('focusout', left)
    return () => {
      document.removeEventListener('pointerdown', outside)
      field?.removeEventListener('focusout', left)
    }
  }, [layout, onClose, keepWords, applySearch, busy])

  // Typed words are asked for after a pause; each new keystroke drops the
  // request before it, and an answer for older words is ignored.
  const canSearch = allows(user, 'viewFiles') || allows(user, 'viewLinks')
  const latest = useRef('')
  useEffect(() => {
    latest.current = trimmed
    // Nothing to search when the role can list none of what's searched.
    if (reason || !canSearch) {
      setSearch({ state: 'idle' })
      return
    }
    const controller = new AbortController()
    // The last answer stays on screen while the next one comes.
    setSearch((current) =>
      current.state === 'done' && current.query === trimmed
        ? current
        : {
            state: 'loading',
            query: trimmed,
            previous:
              current.state === 'done'
                ? current.results
                : current.state === 'loading'
                  ? current.previous
                  : null,
          }
    )
    const timer = setTimeout(() => {
      apiRequest<FindResults>('/api/search', {
        body: { q: trimmed },
        signal: controller.signal,
        fallback: 'Search failed.',
      }).then(
        (results) => {
          if (latest.current === trimmed)
            setSearch({ state: 'done', query: trimmed, results })
        },
        () => {
          if (!controller.signal.aborted && latest.current === trimmed)
            setSearch({ state: 'failed', query: trimmed })
        }
      )
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [trimmed, reason, retry, canSearch])

  // An action that stays on Files (a dialog, a sheet, the theme) leaves
  // the library as it was before typing, not filtered by the words.
  // At once (not after a router round trip), so a sheet opened next
  // builds its address from the library as it was.
  const putBackSearch = () => {
    // Leaving for a result: what was typed isn't applied on the way out.
    leaving.current = true
    if (!onFiles) return
    const params = new URLSearchParams(window.location.search)
    if (startingSearch) params.set('search', startingSearch)
    else params.delete('search')
    const kept = params.toString()
    // State of our own (null), so the App Router takes the new address in:
    // its own state would make it skip this change and keep the filter.
    window.history.replaceState(
      null,
      '',
      kept ? `${pathname}?${kept}` : pathname
    )
  }
  const go = (href: string) => {
    onOpenChange(false)
    // Typing filtered Files as a preview; leaving for somewhere else puts
    // its search back first, so Back returns to the view it was.
    putBackSearch()
    router.push(href)
  }
  const copy = async (text: string, what = 'Link') => {
    if (await copyText(text)) toast({ title: `${what} copied` })
    else
      toast({
        title: 'Couldn’t copy',
        description: 'Open it and copy the address from your browser.',
        variant: 'destructive',
      })
  }

  const placeRow = (place: Place): Row => ({
    value: `place:${place.id}`,
    icon:
      place.group === 'Pages' ? (
        <ArrowRight className="h-4 w-4" />
      ) : place.group === 'Instance settings' ? (
        <Wrench className="h-4 w-4" />
      ) : (
        <Settings2 className="h-4 w-4" />
      ),
    title: place.title,
    meta: place.off ? `Off · turn it on in ${place.off}` : place.where,
    run: () => {
      if (place.opens !== 'tags') return go(place.href)
      putBackSearch()
      onOpenChange(false)
      onManageTags()
    },
  })

  const doRows: Row[] = [
    ...(allows(user, 'uploadFiles')
      ? [
          {
            value: 'do:upload',
            icon: <Upload className="h-4 w-4" />,
            title: 'Upload files',
            run: () => go('/dashboard/upload'),
          },
        ]
      : []),
    ...(allows(user, 'createPaste')
      ? [
          {
            value: 'do:paste',
            icon: <FileText className="h-4 w-4" />,
            title: 'New paste',
            run: () => go('/dashboard/paste'),
          },
        ]
      : []),
    // Links (the page) also needs its own view permission.
    ...(can('links.create') && allows(user, 'viewLinks')
      ? [
          {
            value: 'do:shorten',
            icon: <LinkIcon className="h-4 w-4" />,
            title: 'Shorten a link',
            run: () => go('/dashboard/urls'),
          },
        ]
      : []),
    ...(can('appearance.personal') && resolvedTheme
      ? [
          {
            value: 'do:theme',
            icon:
              resolvedTheme === 'dark' ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              ),
            title:
              resolvedTheme === 'dark'
                ? 'Switch to light theme'
                : 'Switch to dark theme',
            run: async () => {
              putBackSearch()
              const themeMode = resolvedTheme === 'dark' ? 'light' : 'dark'
              setBusy(true)
              try {
                await apiRequest('/api/customization/preferences', {
                  method: 'PATCH',
                  body: { themeMode },
                  fallback: 'Your theme couldn’t be saved.',
                })
                await refreshAppearance()
                onOpenChange(false)
              } catch (failure) {
                // Still open: what's typed next is the search again.
                leaving.current = false
                toast({
                  title: 'Couldn’t switch theme',
                  description:
                    failure instanceof Error ? failure.message : undefined,
                  variant: 'destructive',
                })
              } finally {
                setBusy(false)
              }
            },
          },
        ]
      : []),
  ]

  const openFile = (file: FileType) => {
    if (trimmed) rememberFind(query, `file:${file.id}`, user?.id)
    // Files stays as it was before typing, as for every other row.
    putBackSearch()
    onClose(false)
    openFileSheet(file.id)
  }
  const recentRows = useRecentRows(
    openFile,
    (onFiles && layout === 'bar') || Boolean(startingQuery)
  )

  const groups: { heading: string; rows: Row[]; state?: ReactNode }[] = []
  if (!trimmed) {
    // Short on purpose: your newest files and what you can make. Pages and
    // settings come as you type.
    // On Files in the bar the library is right there; a phone's full-screen
    // Find covers it, so it lists the newest files instead.
    if (recentRows.length && !(onFiles && layout === 'bar'))
      groups.push({ heading: 'Recent', rows: recentRows })
  } else {
    const url = reason === 'link' ? asLink(trimmed) : null
    const carries = url ? linkCarriesCredential(url) : null
    if (url && carries && can('links.create') && allows(user, 'viewLinks'))
      // A link holding a token is never shortened from a key press here:
      // Links shows it, and making it public there is a deliberate step.
      groups.push({
        heading: 'Link',
        rows: [
          {
            value: 'do:open-in-links',
            icon: <ShieldAlert className="h-4 w-4" />,
            title: 'Open this link in Links',
            meta: `It carries ${carries}, so it isn’t shortened from here`,
            run: () => {
              handOff({ kind: 'link', url })
              go('/dashboard/urls')
            },
          },
        ],
      })
    // Never shortened from here when it carries a credential, whatever
    // else the role may do.
    else if (url && !carries && can('links.create'))
      groups.push({
        heading: 'Link',
        rows: [
          {
            value: 'do:shorten-this',
            icon: <LinkIcon className="h-4 w-4" />,
            title: `Shorten ${readable(url)}`,
            meta: 'Makes a short link and copies it',
            run: async () => {
              // Once, however fast the presses.
              if (shortening.current) return
              shortening.current = true
              setBusy(true)
              try {
                // The same ending as a pasted link's: the address, and the
                // link's sheet.
                const made = await shortenAndCopy(url)
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
                onOpenChange(false)
              } catch (failure) {
                toast({
                  title: 'Couldn’t shorten the link',
                  description:
                    failure instanceof Error ? failure.message : undefined,
                  variant: 'destructive',
                })
              } finally {
                shortening.current = false
                setBusy(false)
              }
            },
          },
        ],
      })
    // Without short links, a link can still become a paste.
    else if (url && !carries && allows(user, 'createPaste'))
      groups.push({
        heading: 'Link',
        rows: [
          {
            value: 'do:paste-link',
            icon: <FileText className="h-4 w-4" />,
            title: 'Open this link in Paste',
            meta: 'Links aren’t searched',
            run: () => {
              handOff({ kind: 'text', text: url })
              go('/dashboard/paste')
            },
          },
        ],
      })
    // Long text goes to Paste; text holding a secret only as a private
    // paste (the same rule as the paste card).
    // (A secret on several lines, or long, is text to keep, not a search.)
    const asText =
      reason === 'long' ||
      (reason === 'secret' &&
        (/\n/.test(trimmed) || trimmed.length > SEARCHABLE_MAX))
    const textSecret = asText ? heldTextSecret : null
    if (asText && allows(user, 'createPaste') && (!textSecret || privatePaste))
      groups.push({
        heading: 'Text',
        rows: [
          {
            value: 'do:paste-this',
            icon: <FileText className="h-4 w-4" />,
            title: 'Open this text in Paste',
            meta: textSecret
              ? `It holds ${textSecret}, so it opens as a private paste`
              : 'Long text isn’t searched',
            run: () => {
              handOff({ kind: 'text', text: query, private: !!textSecret })
              go('/dashboard/paste')
            },
          },
        ],
      })
    // A credential link the role can't hand to Links: a private paste.
    if (linkNoted && privatePaste)
      groups.push({
        heading: 'Link',
        rows: [
          {
            value: 'do:paste-private',
            icon: <ShieldAlert className="h-4 w-4" />,
            title: 'Open this link in Paste',
            meta: 'As a private paste',
            run: () => {
              handOff({ kind: 'text', text: url ?? trimmed, private: true })
              go('/dashboard/paste')
            },
          },
        ],
      })
    const matched = matchPlaces(places, trimmed)
    const pages = matched.filter((place) => place.group === 'Pages')
    const settings = matched.filter((place) => place.group !== 'Pages')
    const normalized = normalizeQuery(trimmed)
    // Not a second row for a page already listed (upload, paste, shorten).
    const listed = new Set(pages.map((place) => place.href))
    const doMatched = doRows.filter(
      (row) =>
        normalizeQuery(row.title).includes(normalized) &&
        !listed.has(DO_PAGES[row.value] ?? '')
    )
    if (pages.length || doMatched.length)
      groups.push({
        heading: 'Go to',
        rows: [...pages.map(placeRow), ...doMatched],
      })
    if (settings.length)
      groups.push({ heading: 'Settings', rows: settings.map(placeRow) })
    if (!reason) {
      const results =
        search.state === 'done'
          ? search.results
          : search.state === 'loading'
            ? search.previous
            : null
      const loading = search.state === 'loading' && !search.previous
      const failed = search.state === 'failed'
      const files = results?.files ?? []
      const links = results?.links ?? []
      const folders = results?.folders ?? []
      // Files come first, except in the bar on Files, whose grid shows them
      // as you type.
      if (files.length && !(filtering && !narrowed))
        groups.unshift({
          heading: 'Files',
          rows: files.map((file) =>
            fileRow(file, openFile, allows(user, 'shareFiles'))
          ),
        })
      if (folders.length)
        groups.push({
          heading: 'Folders',
          rows: folders.map((folder) => ({
            value: `folder:${folder.id}`,
            icon: <Folder className="h-4 w-4" />,
            title: folder.name,
            run: () => go(libraryHref({ folder: folder.id })),
          })),
        })
      if (links.length)
        groups.push({
          heading: 'Links',
          rows: links.map((link) => {
            const short = shortLinkUrl(link.shortCode, window.location.origin)
            return {
              value: `link:${link.id}`,
              icon: <LinkIcon className="h-4 w-4" />,
              title: `/u/${link.shortCode}`,
              meta: `→ ${readable(link.targetUrl)} · ${link.clicks} ${link.clicks === 1 ? 'click' : 'clicks'}`,
              // Its sheet, where it's managed; opening it counts no click.
              run: () => {
                rememberFind(query, `link:${link.id}`, user?.id)
                putBackSearch()
                onClose(false)
                openLinkSheet(link.id)
              },
              copy: short,
            }
          }),
        })
      if (loading || failed)
        groups.push({
          heading: 'Your files and links',
          rows: [],
          state: failed ? (
            <span className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              Couldn’t search.
              <button
                type="button"
                className="underline underline-offset-4"
                onClick={() => setRetry((value) => value + 1)}
                // Its own keys: Find's Enter would run a row instead.
                onKeyDown={ownKeys}
              >
                Try again
              </button>
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Searching…
            </span>
          ),
        })
    }
    // "All files matching" only when the library has more than Find lists,
    // and only for typed words: a link or secret would end up in its address.
    const more =
      search.state === 'done' &&
      (search.results.files?.length ?? 0) >= FIND_LIMIT
    if (allows(user, 'viewFiles') && !reason && !onFiles && more) {
      const all: Row = {
        value: 'do:search-files',
        icon: <Search className="h-4 w-4" />,
        title: `All files matching “${trimmed}”`,
        run: () => go(libraryHref({ search: trimmed })),
      }
      const files = groups.find((group) => group.heading === 'Files')
      if (files) files.rows.push(all)
      else groups.push({ heading: 'Files', rows: [all] })
    }
    // On Files, what the words do to the grid, as a row like any other:
    // first, so Enter applies them and puts Find away.
    if (
      allows(user, 'viewFiles') &&
      onFiles &&
      (!reason || reason === 'short')
    ) {
      const show: Row = {
        value: 'do:show-files',
        icon: <Search className="h-4 w-4" />,
        // In the bar the grid is already filtered; full screen covers it.
        title: layout === 'bar' ? 'Keep this search' : 'Show matching files',
        run: () => {
          applySearch()
          onClose()
        },
      }
      const files = groups.find((group) => group.heading === 'Files')
      // With no file matching, a setting, folder or link is what was meant:
      // it comes first, and keeping the empty search is the last row.
      // While new words load, the last answer decides (or none yet), so a
      // quick Enter doesn't land on an empty search.
      const known =
        search.state === 'done'
          ? search.results
          : search.state === 'loading'
            ? search.previous
            : null
      const noFiles = !(known?.files?.length ?? 0)
      // With nothing matching and something else found, keeping the empty
      // search isn't offered at all.
      // In a folder, files found elsewhere are what the grid can't show,
      // so they come first there.
      if (files) files.rows[narrowed ? 'push' : 'unshift'](show)
      else if (!noFiles) groups.unshift({ heading: 'Files', rows: [show] })
      else if (!groups.some((group) => group.rows.length))
        groups.push({ heading: 'Files', rows: [show] })
    }
  }

  // Results for earlier words stay in place while the new ones load, so the
  // list doesn't jump, but they can't be chosen.
  if (search.state === 'loading')
    for (const group of groups)
      if (['Files', 'Folders', 'Links'].includes(group.heading))
        group.rows = group.rows.map((row) =>
          row.value.startsWith('do:') ? row : { ...row, stale: true }
        )
  const rows = groups.flatMap((group) => group.rows)
  const choosable = rows.filter((row) => !row.stale)
  const active = choosable.find((row) => row.value === selected) ?? choosable[0]
  const count = rows.length
  // What a waiting Enter runs: the row picked, the result Find resumed
  // with once it's back, or the answer's first row.
  const firstChoice = useRef<Row | undefined>(undefined)
  firstChoice.current = picked
    ? active
    : ((resumed && query === resumed.query
        ? choosable.find((row) => row.value === resumed.row)
        : undefined) ?? choosable[0])
  useEffect(() => {
    if (!enterWaiting || search.state === 'loading') return
    setEnterWaiting(false)
    // Only an answer runs it: a failed search leaves the Enter unanswered
    // rather than guessing, and words cleared meanwhile cancel it.
    if (search.state !== 'done') return
    void firstChoice.current?.run()
  }, [enterWaiting, search.state])
  // Typed words that found nothing (and whose search didn't fail, which its
  // group says): never shown for a secret, a link or long text.
  const nothingFound =
    Boolean(trimmed) &&
    (!reason || reason === 'short') &&
    !rows.length &&
    search.state !== 'loading' &&
    search.state !== 'failed'
  useEffect(() => {
    if (!trimmed) return setAnnouncement('')
    setAnnouncement(
      search.state === 'loading'
        ? ''
        : search.state === 'failed'
          ? 'Couldn’t search'
          : `${count} ${count === 1 ? 'result' : 'results'}`
    )
  }, [count, search.state, trimmed])

  const command = (
    <Command
      shouldFilter={false}
      loop
      value={active?.value ?? ''}
      onValueChange={setSelected}
      label="Find"
      ref={root}
      className={layout === 'bar' ? 'relative w-full' : 'flex h-full flex-col'}
      onKeyDown={(event) => {
        // Keys that end an IME composition aren't Find's.
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Escape') {
          event.preventDefault()
          setEnterWaiting(false)
          setPicked(false)
          // Esc undoes what was typed first, then puts Find away. On Files
          // that's the search Find opened with: a kept search stays (its ×
          // clears it), and words typed since go back to it.
          const opened = startingSearch ?? ''
          if (onFiles && query !== opened) {
            setQuery(opened)
            applySearch(opened)
          } else if (!onFiles && query) setQuery('')
          else {
            // Words cleared within the pause may not have reached the
            // library yet: it closes on the search Find opened with.
            if (onFiles) applySearch(opened)
            onClose()
          }
          return
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          // A row chosen now is what Enter means, not the answer awaited.
          setPicked(true)
          setEnterWaiting(false)
        }
        if (
          event.key === 'Enter' &&
          !event.metaKey &&
          !event.ctrlKey &&
          !reason &&
          !picked &&
          search.state === 'loading'
        ) {
          event.preventDefault()
          setEnterWaiting(true)
          return
        }
        // ⌘/Ctrl+Enter only ever copies: a row with nothing to copy isn't
        // run instead.
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          if (active?.copy) void copy(active.copy)
        }
      }}
    >
      <div
        className={
          layout === 'bar'
            ? 'flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 shadow-sm dark:border-border/60'
            : 'flex items-center gap-2 border-b px-4'
        }
      >
        <Search className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <Command.Input
          ref={input}
          // Full screen, the dialog focuses the field after Find opens; the
          // first focus selects what it opened with, too.
          onFocus={(event) => {
            if (selectedOnFocus.current) return
            selectedOnFocus.current = true
            event.currentTarget.select()
          }}
          value={query}
          onValueChange={(next) => {
            setQuery(next)
            setEdited(true)
            // Still here (an action that stayed failed): not leaving.
            leaving.current = false
            // New words: an Enter waiting on the old ones, and a row picked
            // among them, no longer apply.
            setEnterWaiting(false)
            setPicked(false)
          }}
          onPaste={(event) => {
            // An input keeps one line of what's pasted; Find keeps
            // the whole text so it can offer Paste instead of a search.
            const pasted = event.clipboardData.getData('text/plain')
            // A pasted secret (or credential link) replaces what's there,
            // so it's judged, and held back, on its own.
            const alone = searchHold(pasted).reason
            const credentialLink =
              alone === 'link' &&
              Boolean(linkCarriesCredential(asLink(pasted.trim()) ?? ''))
            if (
              !/\n/.test(pasted.trim()) &&
              alone !== 'secret' &&
              !credentialLink
            )
              return
            event.preventDefault()
            setQuery(pasted)
            setEdited(true)
            setEnterWaiting(false)
            setPicked(false)
          }}
          autoFocus
          placeholder="Find a file, link, folder or setting"
          className={cn(
            'min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground',
            layout === 'bar' ? 'h-9 text-sm' : 'h-12 text-base'
          )}
        />
        {busy && (
          <Loader2
            className="h-4 w-4 animate-spin text-muted-foreground"
            aria-label="Working"
          />
        )}
        {layout === 'bar' ? (
          <kbd className="rounded border border-border/70 px-1.5 font-sans text-[11px] text-muted-foreground">
            Esc
          </kbd>
        ) : (
          <button
            type="button"
            className="text-sm text-muted-foreground"
            onClick={() => onClose()}
            onKeyDown={ownKeys}
          >
            Close
          </button>
        )}
      </div>
      {/* Nothing to list (on Files before typing, or when the grid below
          already shows every match): no panel. */}
      {/* Only with something in it: rows, a group's state, the secret
          warning, or "Nothing for". */}
      {(layout === 'screen' ||
        rows.length > 0 ||
        groups.length > 0 ||
        reason === 'secret' ||
        linkNoted ||
        (nothingFound && !(filtering && !narrowed))) && (
        <Command.List
          className={
            layout === 'bar'
              ? 'absolute left-1/2 top-[calc(100%+20px)] z-50 max-h-[min(32rem,calc(100dvh-8rem))] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 overflow-y-auto overscroll-contain rounded-2xl border border-border bg-overlay p-2 shadow-xl shadow-black/20 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 dark:shadow-black/60'
              : 'min-h-0 flex-1 overflow-y-auto overscroll-contain p-2'
          }
        >
          {reason === 'secret' && (
            <p className="mb-1 flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
              <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
              That looks like a secret, so it wasn’t searched.
            </p>
          )}
          {linkNoted && (
            <p className="mb-1 flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
              <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
              That link carries{' '}
              {linkCarriesCredential(asLink(trimmed) ?? '') ?? 'a token'}, so it
              isn’t searched or shortened here.
            </p>
          )}
          {/* Never echoes back a secret or a long text. */}
          {nothingFound && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing for “{trimmed}”.
            </p>
          )}
          {groups.map((group) => (
            <Command.Group
              key={group.heading}
              heading={group.heading}
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[.14em] [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              {group.state && (
                <div className="px-3 py-2 text-sm text-muted-foreground">
                  {group.state}
                </div>
              )}
              {group.rows.map((row) => (
                <Command.Item
                  key={row.value}
                  value={row.value}
                  disabled={busy || row.stale}
                  onSelect={() => {
                    setEnterWaiting(false)
                    void row.run()
                  }}
                  onPointerMove={() => {
                    setPicked(true)
                    setEnterWaiting(false)
                  }}
                  className="group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm data-[disabled=true]:cursor-default data-[disabled=true]:opacity-50 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/60 bg-background/60 text-muted-foreground">
                    {row.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {row.title}
                    </span>
                    {row.meta && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.meta}
                      </span>
                    )}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </Command>
  )

  if (layout === 'bar') return command
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        data-flare-fullscreen=""
        // Esc is Find's own: it clears the words first, then closes.
        onEscapeKeyDown={(event) => event.preventDefault()}
        className="!m-0 h-[100dvh] max-h-[100dvh] w-full max-w-none gap-0 overflow-hidden rounded-none p-0 sm:p-0"
      >
        <DialogTitle className="sr-only">Find</DialogTitle>
        {command}
      </DialogContent>
    </Dialog>
  )
}

function fileRow(
  file: FileType,
  open: (file: FileType) => void,
  /** ⌘/Ctrl+Enter copies its link only for a role that may share it. */
  canCopy: boolean
): Row {
  const page = fileUrls(file, { origin: window.location.origin }).page
  return {
    value: `file:${file.id}`,
    // A picture tells three image.png apart better than their names.
    icon: hasThumbnail(file) ? (
      <img
        src={thumbnailLoader({ src: fileUrls(file).thumbnail, width: 64 })}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover"
      />
    ) : (
      <FileTypeIcon file={file} className="h-4 w-4" />
    ),
    title: file.name,
    meta: [
      formatDistanceToNowStrict(new Date(file.uploadedAt), {
        addSuffix: true,
      }),
      formatFileSize(file.size),
      file.visibility === 'PUBLIC' ? 'Public' : 'Private',
      file.hasPassword ? 'Password' : null,
    ]
      .filter(Boolean)
      .join(' · '),
    run: () => open(file),
    copy: canCopy ? page : undefined,
  }
}

/** The account's newest files, for Find's empty state. */
function useRecentRows(
  open: (file: FileType) => void,
  /** Not shown (the bar on Files, or Find opened with words in it). */
  skip: boolean
): Row[] {
  const { can, user } = usePermissions()
  const [files, setFiles] = useState<FileType[]>([])
  const enabled = can('files.read') && !skip
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    apiRequest<FileType[]>('/api/files?limit=4', {
      signal: controller.signal,
    }).then(
      (list) => setFiles(Array.isArray(list) ? list : []),
      () => {}
    )
    return () => controller.abort()
  }, [enabled])
  const canCopy = allows(user, 'shareFiles')
  return files.map((file) => fileRow(file, open, canCopy))
}
