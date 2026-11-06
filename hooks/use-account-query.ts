'use client'

import {
  Fragment,
  type ReactNode,
  createElement,
  useCallback,
  useMemo,
} from 'react'

import {
  type QueryKey,
  type UseQueryOptions,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useSession } from 'next-auth/react'

import { apiRequest } from '@/lib/client/request'

/** The signed-in account and this browser's session with it. */
export interface SessionScope {
  userId: string
  sessionId: string
  /** Both as one string, which names the session in keys. */
  key: string
}

function useScope() {
  const { data, status } = useSession()
  // A refresh through `update()` reports `loading` but keeps the session it
  // refreshes, so the scope and its data stay until the session ends.
  const user = status === 'unauthenticated' ? undefined : data?.user
  const userId = user?.id
  const sessionId = user?.sessionId
  const scope = useMemo<SessionScope | null>(
    () =>
      userId && sessionId
        ? { userId, sessionId, key: JSON.stringify([userId, sessionId]) }
        : null,
    [userId, sessionId]
  )
  return { status, scope }
}

/** The signed-in session, or null while signed out or before it is known. */
export function useSessionScope() {
  return useScope().scope
}

/**
 * Renders `children` for the signed-in session, from scratch whenever the
 * account or browser session changes, so no state of the previous session
 * survives. Shows `loading` until a session is first known and `signedOut`
 * without one.
 */
export function SessionScoped({
  children,
  loading = null,
  signedOut = null,
}: {
  children: (scope: SessionScope) => ReactNode
  loading?: ReactNode
  signedOut?: ReactNode
}) {
  const { status, scope } = useScope()
  if (!scope) return status === 'loading' ? loading : signedOut
  return createElement(Fragment, { key: scope.key }, children(scope))
}

/**
 * The key of an account's data: its name, the account and browser session,
 * then whatever tells its reads apart.
 */
export function accountKey(
  name: string,
  scope: SessionScope | null,
  ...rest: unknown[]
): QueryKey {
  return [name, scope?.userId, scope?.sessionId, ...rest]
}

/**
 * Account data is kept only while something shows it, and read again
 * whenever something starts showing it.
 */
export const ACCOUNT_DATA = { staleTime: 0, gcTime: 0 } as const

export type AccountQueryOptions<T> = Omit<
  UseQueryOptions<T, Error, T>,
  'queryKey' | 'queryFn' | 'staleTime' | 'gcTime' | 'enabled'
> & {
  enabled?: boolean
  /** Tells apart reads of one path that must not share data. */
  key?: readonly unknown[]
  /** The message for a refusal that gives no reason. */
  fallback?: string
  /** Keep the whole answer rather than its `data`. */
  whole?: boolean
}

/**
 * Reads `path` for the signed-in session, and only while there is one. Each
 * session has its own data, kept as `ACCOUNT_DATA` says.
 */
export function useAccountQuery<T>(
  name: string,
  path: string,
  {
    enabled = true,
    key = [],
    fallback,
    whole,
    ...options
  }: AccountQueryOptions<T> = {}
) {
  const scope = useSessionScope()
  return useQuery({
    ...options,
    ...ACCOUNT_DATA,
    queryKey: accountKey(name, scope, path, ...key),
    queryFn: ({ signal }) => apiRequest<T>(path, { signal, fallback, whole }),
    enabled: !!scope && enabled,
  })
}

/** Reads every open query of this name again; resolves once they have loaded. */
export function useAccountRefresh(name: string) {
  const client = useQueryClient()
  const scope = useSessionScope()
  return useCallback(
    () => client.invalidateQueries({ queryKey: accountKey(name, scope) }),
    [client, name, scope]
  )
}
