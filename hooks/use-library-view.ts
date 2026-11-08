'use client'

import { useCallback, useLayoutEffect, useRef, useState } from 'react'

import {
  type LibraryView,
  type LibraryViewSnapshot,
  libraryViewForAccount,
  libraryViewStorageKey,
  parseLibraryView,
} from '@/lib/library/view'

/** No server preference or account mutation: this browser stores only the view. */
export function useLibraryView(
  accountId: string | null,
  beforeChange: () => void
) {
  const [snapshot, setSnapshot] = useState<LibraryViewSnapshot | null>(null)
  const view = libraryViewForAccount(accountId, snapshot)
  const current = useRef({ accountId, view })
  current.current = { accountId, view }
  const prepare = useRef(beforeChange)
  prepare.current = beforeChange

  useLayoutEffect(() => {
    const key = libraryViewStorageKey(accountId)
    if (!accountId || !key) return
    let saved: LibraryView = 'gallery'
    try {
      saved = parseLibraryView(localStorage.getItem(key))
    } catch {}
    if (saved !== current.current.view) prepare.current()
    current.current = { accountId, view: saved }
    setSnapshot({ accountId, view: saved })
  }, [accountId])

  const setView = useCallback(
    (next: LibraryView) => {
      const key = libraryViewStorageKey(accountId)
      if (!accountId || !key || current.current.accountId !== accountId) return
      if (next !== current.current.view) prepare.current()
      current.current = { accountId, view: next }
      setSnapshot({ accountId, view: next })
      try {
        localStorage.setItem(key, next)
      } catch {}
    },
    [accountId]
  )

  return { view, setView }
}
