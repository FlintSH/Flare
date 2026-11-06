'use client'

import { useCallback, useRef } from 'react'

import { useQueryClient } from '@tanstack/react-query'

import { type LibraryList, libraryChanged } from '@/lib/library/changes'

import { useAccountQuery, useSessionScope } from '@/hooks/use-account-query'
import { useRequestLifetime } from '@/hooks/use-request-lifetime'

/**
 * A list drawn from the library, such as its tags, for the signed-in session.
 * `changed()` shows a change to the library everywhere and resolves once the
 * lists have loaded again. Neither it nor `reload()` acts after the session
 * or the component using them has gone.
 */
export function useLibraryList<T>(name: LibraryList, path: string) {
  const client = useQueryClient()
  const lifetime = useRequestLifetime()
  const scope = useSessionScope()
  const query = useAccountQuery<T[]>(name, path)
  const currentScope = useRef(scope?.key)
  currentScope.current = scope?.key
  const live = useCallback(
    () =>
      !!scope &&
      currentScope.current === scope.key &&
      !lifetime.current.signal.aborted,
    [scope, lifetime]
  )
  const refetch = query.refetch
  const reload = useCallback(async () => {
    if (live()) return refetch()
  }, [live, refetch])
  return {
    items: scope ? (query.data ?? []) : [],
    loading: !!scope && query.isPending,
    error: !!scope && query.isError,
    reload,
    changed: () => (live() ? libraryChanged(client) : Promise.resolve()),
  }
}
