'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import type { FileType } from '@/types/components/file'

import { useAccountKeyState } from '@/components/providers/account-keys-provider'

import { apiRequest } from '@/lib/client/request'
import {
  BATCH_LIMIT,
  type FileTimeline,
  type LibraryFilters,
  librarySort,
  listQuery,
} from '@/lib/library/contract'
import { searchIndex } from '@/lib/library/search-client'
import {
  type OrderedEntry,
  type SortKey,
  type ViewQuery,
  mergeEntries,
  needsClient,
  timelineOf,
} from '@/lib/library/search-core'

/**
 * A library view that the server cannot answer alone (docs/e2ee-spec.md,
 * section 9.8): a search, a type filter or an order by name, in an account
 * that has encrypted files. The server lists the plain files that match,
 * as `[id, sort key]`. The search worker lists the encrypted files that
 * match, from the names and text it holds in memory. Both become one
 * ordered list here, and the rows load as the list scrolls: plain rows from
 * the server by ID, encrypted rows from the local cache.
 *
 * The server gets the search for its plain files, as it always did. It
 * never gets the encrypted files that matched.
 *
 * It answers with the shape of `useFileTimeline`, so the same list shows it.
 */

/** How often a list is built again while the worker still opens records. */
const REFRESH_MS = 1500
/** Rows kept in memory, beyond the ones on the screen. */
const ROW_CACHE = 1200
const REQUESTS_AT_ONCE = 4

function viewQuery(filters: LibraryFilters): ViewQuery {
  const sort = librarySort(filters.sortBy)
  return {
    search: filters.search,
    types: filters.types,
    folder: filters.folder,
    tag: filters.tag,
    visibility: filters.visibility,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    sort: { field: sort.field, direction: sort.direction },
  }
}

/**
 * Whether the browser answers this view. It does when the view needs names
 * or types, the keys are unlocked, and the account can have encrypted files:
 * until the index knows that it has none.
 */
export function useClientView(filters: LibraryFilters): boolean {
  const keys = useAccountKeyState()
  const index = useSyncExternalStore(
    searchIndex.subscribe,
    searchIndex.getState,
    searchIndex.getState
  )
  // The worker starts when the keys unlock. Until it has started, the view
  // waits for it: the server's answer alone would put every encrypted file
  // first in an order by name, and leave them out of a search.
  return (
    keys.status === 'unlocked' &&
    needsClient(viewQuery(filters)) &&
    !(!index.stopped && index.status === 'ready' && index.total === 0)
  )
}

/** The version of the index, moving at most every `REFRESH_MS` until it is ready. */
function useIndexVersion() {
  const index = useSyncExternalStore(
    searchIndex.subscribe,
    searchIndex.getState,
    searchIndex.getState
  )
  const [version, setVersion] = useState(index.version)
  const latest = useRef(index.version)
  latest.current = index.version
  const ready = index.status === 'ready' && !index.stopped
  useEffect(() => {
    if (ready) {
      setVersion(latest.current)
      return
    }
    const timer = window.setInterval(
      () => setVersion(latest.current),
      REFRESH_MS
    )
    return () => window.clearInterval(timer)
  }, [ready, index.version])
  return {
    version,
    ready,
    stopped: index.stopped,
    indexed: index.indexed,
    total: index.total,
  }
}

async function plainOrder(query: string, signal: AbortSignal) {
  const keys: (readonly [string, SortKey])[] = []
  let after: string | undefined
  for (;;) {
    const page = await apiRequest<{
      keys: (readonly [string, SortKey])[]
      more: boolean
    }>(
      `/api/files/order?${query}${after ? `&after=${encodeURIComponent(after)}` : ''}`,
      { signal }
    )
    for (const key of page.keys) keys.push(key)
    if (!page.more || !page.keys.length) return keys
    after = page.keys[page.keys.length - 1][0]
  }
}

interface View {
  key: string
  /** The plain matches and the grouping that this view was built for. */
  plainKey: string
  grouping: string
  entries: OrderedEntry[]
  timeline: FileTimeline
}

export function useMergedLibrary(
  filters: LibraryFilters,
  refreshKey: number,
  scope: string | null
) {
  const index = useIndexVersion()
  const query = listQuery(filters).toString()
  const grouping = filters.groupBy
  const plainKey = JSON.stringify([scope, query, refreshKey])
  const viewKey = JSON.stringify([plainKey, grouping, index.version])
  const [view, setView] = useState<View | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  // The plain matches of the current view: asked for one time, while the
  // index grows.
  const plain = useRef<{
    key: string
    keys: Promise<(readonly [string, SortKey])[]>
    controller: AbortController
  } | null>(null)
  const rows = useRef(new Map<string, FileType>())
  const failed = useRef(new Set<string>())
  const loading = useRef(new Set<string>())
  const current = useRef(viewKey)
  current.current = viewKey
  const sort = useMemo(() => librarySort(filters.sortBy), [filters.sortBy])
  const local = useMemo(() => viewQuery(filters), [filters])

  const running = !index.stopped
  useEffect(() => {
    if (!scope || !running) return
    if (plain.current?.key !== plainKey) {
      plain.current?.controller.abort()
      const controller = new AbortController()
      plain.current = {
        key: plainKey,
        controller,
        keys: plainOrder(query, controller.signal),
      }
      rows.current.clear()
      failed.current.clear()
      loading.current.clear()
    }
    let stale = false
    void Promise.all([plain.current.keys, searchIndex.query(local)])
      .then(([plainKeys, encrypted]) => {
        if (stale) return
        const entries = mergeEntries(sort, plainKeys, encrypted)
        setErrorKey(null)
        setView({
          key: viewKey,
          plainKey,
          grouping,
          entries,
          timeline: timelineOf(
            entries,
            sort,
            grouping,
            new Date().toISOString(),
            Intl.DateTimeFormat().resolvedOptions().timeZone
          ),
        })
      })
      .catch(() => {
        if (!stale) setErrorKey(viewKey)
      })
    return () => {
      stale = true
    }
  }, [scope, running, plainKey, viewKey, query, local, sort, grouping])

  useEffect(
    () => () => {
      plain.current?.controller.abort()
      plain.current = null
    },
    []
  )

  // A view of an older index version stays on screen until the new one is
  // built, so the list does not blink while the worker opens records.
  const shown =
    scope && view?.plainKey === plainKey && view.grouping === grouping
      ? view
      : null
  const entries = shown?.entries
  const timeline = shown?.timeline ?? null
  const error = !!scope && errorKey === viewKey && !shown

  const ensureRange = useCallback(
    (indices: number[]) => {
      if (!entries) return
      const wanted = indices.flatMap((position) => {
        const entry = entries[position]
        return entry &&
          !rows.current.has(entry.id) &&
          !loading.current.has(entry.id) &&
          !failed.current.has(entry.id)
          ? [entry]
          : []
      })
      if (!wanted.length) return
      const started = current.current
      const settle = (ids: string[], loaded: FileType[]) => {
        for (const id of ids) loading.current.delete(id)
        if (current.current !== started) return
        const found = new Map(loaded.map((row) => [row.id, row]))
        for (const id of ids) {
          const row = found.get(id)
          if (row) rows.current.set(id, row)
          // Deleted or changed since the list was built.
          else failed.current.add(id)
        }
        // Rows that left the screen long ago make room.
        while (rows.current.size > ROW_CACHE)
          rows.current.delete(rows.current.keys().next().value!)
        setRevision((value) => value + 1)
      }
      const load = (ids: string[], request: () => Promise<FileType[]>) => {
        for (const id of ids) loading.current.add(id)
        void request().then(
          (loaded) => settle(ids, loaded),
          () => settle(ids, [])
        )
      }
      const encrypted = wanted
        .filter((entry) => entry.encrypted)
        .map((entry) => entry.id)
      if (encrypted.length)
        load(
          encrypted,
          async () =>
            (await searchIndex.rows(encrypted)) as unknown as FileType[]
        )
      const plainIds = wanted
        .filter((entry) => !entry.encrypted)
        .map((entry) => entry.id)
      for (
        let start = 0;
        start < plainIds.length && start < BATCH_LIMIT * REQUESTS_AT_ONCE;
        start += BATCH_LIMIT
      ) {
        const ids = plainIds.slice(start, start + BATCH_LIMIT)
        load(ids, () =>
          apiRequest<FileType[]>(
            `/api/files?ids=${ids.map(encodeURIComponent).join(',')}&limit=${BATCH_LIMIT}`
          )
        )
      }
    },
    [entries]
  )

  const getFile = useCallback(
    (position: number) => {
      const entry = entries?.[position]
      return entry ? rows.current.get(entry.id) : undefined
    },
    [entries]
  )
  const hasFailed = useCallback(
    (position: number) => {
      const entry = entries?.[position]
      return entry ? failed.current.has(entry.id) : false
    },
    [entries]
  )
  const retry = useCallback(() => {
    failed.current.clear()
    setRevision((value) => value + 1)
  }, [])

  return {
    timeline,
    error,
    isLoading: !!scope && !timeline && !error,
    revision,
    getFile,
    hasFailed,
    ensureRange,
    retry,
    /** How far the worker is: the list can still grow while it opens records. */
    index: { ready: index.ready, indexed: index.indexed, total: index.total },
  }
}
