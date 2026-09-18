'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'

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
  body?: unknown
): Promise<T> {
  const response = await fetch(url, {
    method,
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
  const { data: session } = useSession()
  const userId = session?.user?.id
  const query = useQuery({
    queryKey: ['vault-tags', userId],
    queryFn: () => tagRequest<TagView[]>('/api/tags'),
    staleTime: 0,
    enabled: !!userId,
  })
  return {
    tags: query.data ?? [],
    loading: query.isPending,
    error: query.isError,
    reload: query.refetch,
    changed: () => {
      void client.invalidateQueries({ queryKey: ['vault-tags', userId] })
      window.dispatchEvent(new Event('flare:files-changed'))
    },
  }
}
