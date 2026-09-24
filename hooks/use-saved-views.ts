'use client'

import { useEffect } from 'react'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'

import type { SavedView } from '@/lib/saved-views/schema'

export class SavedViewRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message)
    this.name = 'SavedViewRequestError'
  }
}

export async function savedViewRequest<T>(
  url: string,
  method = 'GET',
  body?: unknown
): Promise<T> {
  const response = await fetch(url, {
    method,
    cache: 'no-store',
    ...(body !== undefined && {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok)
    throw new SavedViewRequestError(
      typeof result?.error === 'string'
        ? result.error
        : 'Couldn’t update saved views. Please try again.',
      response.status,
      typeof result?.code === 'string' ? result.code : undefined
    )
  return result.data
}

export function useSavedViews() {
  const client = useQueryClient()
  const { data: session } = useSession()
  const userId = session?.user?.id
  const query = useQuery({
    queryKey: ['saved-views', userId],
    queryFn: () => savedViewRequest<SavedView[]>('/api/saved-views'),
    staleTime: 0,
    enabled: !!userId,
  })

  useEffect(() => {
    const changed = () => {
      void client.invalidateQueries({ queryKey: ['saved-views', userId] })
    }
    window.addEventListener('flare:files-changed', changed)
    return () => window.removeEventListener('flare:files-changed', changed)
  }, [client, userId])

  return {
    views: query.data ?? [],
    loading: query.isPending,
    error: query.isError,
    reload: query.refetch,
  }
}
