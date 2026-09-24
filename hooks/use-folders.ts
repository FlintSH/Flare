'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'

import type { FolderView } from '@/lib/folders/schema'

export async function folderRequest<T>(
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
    throw new Error(
      result.error || 'Couldn’t update folders. Please try again.'
    )
  return result.data
}

export function useFolders() {
  const client = useQueryClient()
  const { data: session } = useSession()
  const userId = session?.user?.id
  const query = useQuery({
    queryKey: ['vault-folders', userId],
    queryFn: () => folderRequest<FolderView[]>('/api/folders'),
    staleTime: 0,
    enabled: !!userId,
  })
  return {
    folders: query.data ?? [],
    loading: query.isPending,
    error: query.isError,
    reload: query.refetch,
    changed: () => {
      void client.invalidateQueries({ queryKey: ['vault-folders', userId] })
      window.dispatchEvent(new Event('flare:files-changed'))
    },
  }
}
