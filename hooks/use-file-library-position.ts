import { useCallback, useEffect, useRef } from 'react'

import type { FileFilterOptions } from '@/types/components/file'

import {
  libraryPositionKey,
  readLibraryPosition,
  withLibraryPosition,
} from '@/lib/files/library-position'

import { readFileFilters } from '@/hooks/use-file-filters'

type PendingPosition = {
  key: string
  pathname: string
  query: string
  index: number
  scope?: string
}

/** Store only a filter identity and file rank in this browser history entry. */
export function useFileLibraryPosition(
  filters: FileFilterOptions,
  pathname: string,
  urlQuery: string,
  onRestore: () => void,
  scope?: string
) {
  const key = libraryPositionKey(filters, scope)
  const fallback = (filters.page - 1) * filters.limit
  const position = useRef(
    typeof window === 'undefined'
      ? fallback
      : readLibraryPosition(window.history.state, key, fallback)
  )
  const pending = useRef<PendingPosition | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previous = useRef({ key, pathname, query: urlQuery })
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
      actual.toString() !== next.query ||
      libraryPositionKey(readFileFilters(actual, 24), next.scope) !== next.key
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
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    pending.current = null
    const last = previous.current
    previous.current = { key, pathname, query: urlQuery }
    const actual = new URLSearchParams(window.location.search)
    const matches =
      window.location.pathname === pathname &&
      libraryPositionKey(readFileFilters(actual, 24), scope) === key
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
  }, [key, pathname, urlQuery, fallback, scope])

  useEffect(() => {
    const click = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('a[href]'))
        flush()
    }
    const restore = () => {
      const actual = new URLSearchParams(window.location.search)
      if (
        window.location.pathname !== pathname ||
        libraryPositionKey(readFileFilters(actual, 24), scope) !== key
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
