import { useCallback, useEffect, useMemo, useState } from 'react'

import type { Folder, FolderTreeNode } from '@/types/components/folder'
import type { OrganizationColor } from '@/types/dto/folder'

import { buildFolderTree } from '@/lib/folders/tree'

import { useToast } from '@/hooks/use-toast'

interface UseFoldersOptions {
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

export function useFolders({ enabled = true }: UseFoldersOptions = {}) {
  const { toast } = useToast()
  const [folders, setFolders] = useState<Folder[]>([])
  const [isLoading, setIsLoading] = useState(enabled)

  const tree: FolderTreeNode[] = useMemo(
    () => buildFolderTree(folders),
    [folders]
  )

  const fetchFolders = useCallback(async () => {
    if (!enabled) return
    try {
      setIsLoading(true)
      const response = await fetch('/api/folders')
      if (!response.ok) {
        if (response.status === 404) {
          setFolders([])
          return
        }
        throw new Error('Failed to fetch folders')
      }
      const result = await response.json()
      setFolders(result.data?.folders || [])
    } catch (error) {
      console.error('Error fetching folders:', error)
    } finally {
      setIsLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    fetchFolders()
  }, [fetchFolders])

  const createFolder = useCallback(
    async (input: {
      name: string
      parentId?: string | null
      color?: OrganizationColor | null
    }): Promise<Folder | null> => {
      try {
        const response = await fetch('/api/folders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        })
        if (!response.ok) {
          toast({
            title: 'Failed to create folder',
            description: await parseError(response),
            variant: 'destructive',
          })
          return null
        }
        const result = await response.json()
        await fetchFolders()
        toast({ title: 'Folder created' })
        return result.data as Folder
      } catch {
        toast({ title: 'Failed to create folder', variant: 'destructive' })
        return null
      }
    },
    [fetchFolders, toast]
  )

  const updateFolder = useCallback(
    async (
      id: string,
      input: {
        name?: string
        parentId?: string | null
        color?: OrganizationColor | null
      }
    ): Promise<boolean> => {
      try {
        const response = await fetch(`/api/folders/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        })
        if (!response.ok) {
          toast({
            title: 'Failed to update folder',
            description: await parseError(response),
            variant: 'destructive',
          })
          return false
        }
        await fetchFolders()
        return true
      } catch {
        toast({ title: 'Failed to update folder', variant: 'destructive' })
        return false
      }
    },
    [fetchFolders, toast]
  )

  const deleteFolder = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const response = await fetch(`/api/folders/${id}`, {
          method: 'DELETE',
        })
        if (!response.ok) {
          toast({
            title: 'Failed to delete folder',
            description: await parseError(response),
            variant: 'destructive',
          })
          return false
        }
        await fetchFolders()
        toast({
          title: 'Folder deleted',
          description: 'Files in this folder were kept and moved up a level.',
        })
        return true
      } catch {
        toast({ title: 'Failed to delete folder', variant: 'destructive' })
        return false
      }
    },
    [fetchFolders, toast]
  )

  return {
    folders,
    tree,
    isLoading,
    refetch: fetchFolders,
    createFolder,
    updateFolder,
    deleteFolder,
  }
}
