'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'

import { useAccountKeyState } from '@/components/providers/account-keys-provider'

import type { LibraryFilters } from '@/lib/library/contract'
import { searchIndex } from '@/lib/library/search-client'

import { useFileTimeline } from '@/hooks/use-file-timeline'
import { useClientView, useMergedLibrary } from '@/hooks/use-merged-library'

/**
 * The files of a library view. The server pages most views. A search, a
 * type filter or an order by name in an account with encrypted files is
 * answered in the browser, which is the only place that has their names
 * (docs/e2ee-spec.md, section 9.8). Both give the list the same shape.
 */
export function useLibrary(
  filters: LibraryFilters,
  refreshKey: number,
  scope: string | null
) {
  const client = useClientView(filters)
  const server = useFileTimeline(filters, refreshKey, client ? null : scope)
  const merged = useMergedLibrary(filters, refreshKey, client ? scope : null)
  return client
    ? { ...merged, client: true as const }
    : { ...server, client: false as const, index: null }
}

/** The types of the encrypted files, which the server does not have, for the type filter. */
export function useEncryptedTypes(): string[] {
  const keys = useAccountKeyState()
  const index = useSyncExternalStore(
    searchIndex.subscribe,
    searchIndex.getState,
    searchIndex.getServerState
  )
  const [types, setTypes] = useState<string[]>([])
  const ready = index.status === 'ready' && !index.stopped
  const unlocked = keys.status === 'unlocked'
  useEffect(() => {
    if (!unlocked || !ready) {
      setTypes((current) => (current.length ? [] : current))
      return
    }
    let stale = false
    void searchIndex.types().then(
      (found) => {
        if (!stale) setTypes(found)
      },
      () => undefined
    )
    return () => {
      stale = true
    }
  }, [unlocked, ready, index.indexed])
  return types
}
