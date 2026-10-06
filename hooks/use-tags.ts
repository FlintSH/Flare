'use client'

import { useCallback, useRef } from 'react'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'

import { useRequestLifetime } from '@/hooks/use-request-lifetime'

export interface TagView {
  id: string
  name: string
  ruleSource: 'filename' | 'ocr' | null
  ruleText: string | null
  fileCount: number
}

export async function tagRequest<T>(
  url: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch(url, {
    method,
    signal,
    cache: 'no-store',
    ...(body !== undefined && {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })
  const result = await response.json()
  if (!response.ok)
    throw new Error(result.error || 'Couldn’t update tags. Please try again.')
  return result.data
}

export function useTags() {
  const client = useQueryClient()
  const { data: session, status } = useSession()
  const lifetime = useRequestLifetime()
  const userId = status === 'authenticated' ? session?.user?.id : undefined
  const sessionId =
    status === 'authenticated' ? session?.user?.sessionId : undefined
  const enabled = status === 'authenticated' && !!userId && !!sessionId
  const scope = enabled ? JSON.stringify([userId, sessionId]) : null
  const currentScope = useRef(scope)
  currentScope.current = scope
  const query = useQuery({
    queryKey: ['vault-tags', userId, sessionId],
    queryFn: ({ signal }) =>
      tagRequest<TagView[]>('/api/tags', 'GET', undefined, signal),
    staleTime: 0,
    gcTime: 0,
    enabled,
  })
  const refetch = query.refetch
  const reload = useCallback(async () => {
    if (
      !scope ||
      currentScope.current !== scope ||
      lifetime.current.signal.aborted
    )
      return
    return refetch()
  }, [refetch, scope, lifetime])
  return {
    tags: enabled ? (query.data ?? []) : [],
    loading: enabled && query.isPending,
    error: enabled && query.isError,
    reload,
    changed: () => {
      if (
        !scope ||
        currentScope.current !== scope ||
        lifetime.current.signal.aborted
      )
        return
      void client.invalidateQueries({
        queryKey: ['vault-tags', userId, sessionId],
      })
      window.dispatchEvent(new Event('flare:files-changed'))
    },
  }
}
