import { useCallback, useEffect, useState } from 'react'

import type { Tag } from '@/types/components/tag'
import type { OrganizationColor } from '@/types/dto/folder'

import { useToast } from '@/hooks/use-toast'

interface UseTagsOptions {
  enabled?: boolean
}

async function parseError(response: Response): Promise<string> {
  try {
    const data = await response.json()
    return data.error || 'Something went wrong'
  } catch {
    return 'Something went wrong'
  }
}

export function useTags({ enabled = true }: UseTagsOptions = {}) {
  const { toast } = useToast()
  const [tags, setTags] = useState<Tag[]>([])
  const [isLoading, setIsLoading] = useState(enabled)

  const fetchTags = useCallback(async () => {
    if (!enabled) return
    try {
      setIsLoading(true)
      const response = await fetch('/api/tags')
      if (!response.ok) {
        if (response.status === 404) {
          setTags([])
          return
        }
        throw new Error('Failed to fetch tags')
      }
      const result = await response.json()
      setTags(result.data?.tags || [])
    } catch (error) {
      console.error('Error fetching tags:', error)
    } finally {
      setIsLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    fetchTags()
  }, [fetchTags])

  const createTag = useCallback(
    async (input: {
      name: string
      color?: OrganizationColor | null
    }): Promise<Tag | null> => {
      try {
        const response = await fetch('/api/tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        })
        if (!response.ok) {
          toast({
            title: 'Failed to create tag',
            description: await parseError(response),
            variant: 'destructive',
          })
          return null
        }
        const result = await response.json()
        await fetchTags()
        return result.data as Tag
      } catch {
        toast({ title: 'Failed to create tag', variant: 'destructive' })
        return null
      }
    },
    [fetchTags, toast]
  )

  const updateTag = useCallback(
    async (
      id: string,
      input: { name?: string; color?: OrganizationColor | null }
    ): Promise<boolean> => {
      try {
        const response = await fetch(`/api/tags/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        })
        if (!response.ok) {
          toast({
            title: 'Failed to update tag',
            description: await parseError(response),
            variant: 'destructive',
          })
          return false
        }
        await fetchTags()
        return true
      } catch {
        toast({ title: 'Failed to update tag', variant: 'destructive' })
        return false
      }
    },
    [fetchTags, toast]
  )

  const deleteTag = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const response = await fetch(`/api/tags/${id}`, { method: 'DELETE' })
        if (!response.ok) {
          toast({
            title: 'Failed to delete tag',
            description: await parseError(response),
            variant: 'destructive',
          })
          return false
        }
        await fetchTags()
        toast({ title: 'Tag deleted' })
        return true
      } catch {
        toast({ title: 'Failed to delete tag', variant: 'destructive' })
        return false
      }
    },
    [fetchTags, toast]
  )

  return {
    tags,
    isLoading,
    refetch: fetchTags,
    createTag,
    updateTag,
    deleteTag,
  }
}
