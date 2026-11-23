import { useCallback, useEffect, useRef } from 'react'

import { FILE_SHEET_PARAM, LINK_SHEET_PARAM } from '@/lib/client/file-sheet'
import { type LibraryFilters, readLibraryFilters } from '@/lib/library/contract'
import {
  libraryPositionKey,
  readLibraryPosition,
  withLibraryPosition,
} from '@/lib/library/position'

type PendingPosition = {
  key: string
  pathname: string
  query: string
  index: number
  scope?: string
}

/**
 * The address's query without a file's or link's sheet: a sheet opens over
 * the library, so opening, stepping or closing one doesn't move it.
 */
function libraryQuery(search: string | URLSearchParams) {
  const params = new URLSearchParams(search)
  params.delete(FILE_SHEET_PARAM)
  params.delete(LINK_SHEET_PARAM)
  return params.toString()
}

/** Store only a filter identity and file rank in this browser history entry. */
export function useFileLibraryPosition(
  filters: LibraryFilters,
  pathname: string,
  addressQuery: string,
  onRestore: () => void,
  scope?: string
) {
  const urlQuery = libraryQuery(addressQuery)
  const key = libraryPositionKey(filters, scope)
  const fallback = (filters.page - 1) * filters.limit
  const position = useRef(
    typeof window === 'undefined'
      ? fallback
      : readLibraryPosition(window.history.state, key, fallback)
  )
  const pending = useRef<PendingPosition | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previous = useRef({
    key,
    pathname,
    query: urlQuery,
    address: addressQuery,
  })
  const restoreCallback = useRef(onRestore)
  restoreCallback.current = onRestore

  const flush = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    const next = pending.current
    pending.current = null
    if (!next || window.location.pathname !== next.pathname) return
    const actual = new URLSearchParams(window.location.search)
    // Local filters can change before router.push commits its URL. Equally, a
    // link can commit its destination before this component's cleanup runs.
    if (
      libraryQuery(actual) !== next.query ||
      libraryPositionKey(readLibraryFilters(actual), next.scope) !== next.key
    )
      return
    if (readLibraryPosition(window.history.state, next.key, -1) === next.index)
      return
    try {
      window.history.replaceState(
        withLibraryPosition(window.history.state, next.key, next.index),
        ''
      )
    } catch {
      // Browser history quotas/private-mode restrictions must not break scrolling.
    }
  }, [])

  const record = useCallback(
    (index: number) => {
      if (!Number.isSafeInteger(index) || index < 0) return
      position.current = index
      pending.current = { key, pathname, query: urlQuery, index, scope }
      if (timer.current === null) timer.current = setTimeout(flush, 500)
    },
    [key, pathname, urlQuery, flush, scope]
  )

  useEffect(() => {
    const last = previous.current
    previous.current = { key, pathname, query: urlQuery, address: addressQuery }
    // A sheet opened, stepped or closed over the library: it stays put.
    if (
      last.key === key &&
      last.pathname === pathname &&
      last.query === urlQuery
    )
      return
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    pending.current = null
    const actual = new URLSearchParams(window.location.search)
    const matches =
      window.location.pathname === pathname &&
      libraryPositionKey(readLibraryFilters(actual), scope) === key
    const restored = matches
      ? readLibraryPosition(window.history.state, key, fallback)
      : fallback
    const moved = position.current !== restored
    position.current = restored
    // Filter changes already reload the timeline. Equivalent URL transitions can
    // reuse the same filters, so explicitly remount that viewport when necessary.
    if (
      last.key === key &&
      last.pathname === pathname &&
      last.query !== urlQuery &&
      moved
    )
      restoreCallback.current()
  }, [key, pathname, urlQuery, addressQuery, fallback, scope])

  useEffect(() => {
    const click = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('a[href]'))
        flush()
    }
    const restore = () => {
      const actual = new URLSearchParams(window.location.search)
      if (
        window.location.pathname !== pathname ||
        libraryPositionKey(readLibraryFilters(actual), scope) !== key
      )
        return
      // Back or Forward past a sheet's entry (only the sheet in the address
      // changed): the library under it is where it was.
      const address = actual.toString()
      if (
        address !== previous.current.address &&
        libraryQuery(actual) === previous.current.query
      )
        return
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = null
      pending.current = null
      position.current = readLibraryPosition(
        window.history.state,
        key,
        fallback
      )
      restoreCallback.current()
    }
    window.addEventListener('click', click, true)
    window.addEventListener('pagehide', flush)
    window.addEventListener('popstate', restore)
    return () => {
      window.removeEventListener('click', click, true)
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('popstate', restore)
      flush()
    }
  }, [key, pathname, fallback, flush, scope])

  return { position, record }
}
