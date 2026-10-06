import { useCallback, useEffect, useRef, useState } from 'react'

import type { FileType } from '@/types/components/file'

/** Resolve retained IDs again before bulk dialogs interpret mutable metadata. */
export function useFreshFileSelection(files: FileType[], scope: unknown) {
  const [loading, setLoading] = useState(false)
  const active = useRef<AbortController | null>(null)
  const key = JSON.stringify([scope, files.map((file) => file.id)])
  const currentKey = useRef<string | null>(key)
  currentKey.current = key

  useEffect(() => {
    currentKey.current = key
    active.current?.abort()
    active.current = null
    setLoading(false)
    return () => {
      currentKey.current = null
      active.current?.abort()
    }
  }, [key])

  const refresh = useCallback(async () => {
    if (currentKey.current !== key) return null
    active.current?.abort()
    const controller = new AbortController()
    active.current = controller
    setLoading(true)
    try {
      const params = new URLSearchParams({
        ids: files.map((file) => file.id).join(','),
        limit: '100',
      })
      const response = await fetch(`/api/files?${params}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok)
        throw new Error('Couldn’t refresh selected files. Please try again.')
      const result = await response.json()
      if (controller.signal.aborted || currentKey.current !== key) return null
      const fresh: FileType[] = Array.isArray(result.data) ? result.data : []
      const byId = new Map(fresh.map((file) => [file.id, file]))
      if (
        fresh.length !== files.length ||
        byId.size !== files.length ||
        files.some((file) => !byId.has(file.id))
      )
        throw new Error(
          'Some selected files are no longer available. Clear your selection and choose the files again.'
        )
      return files.map((file) => byId.get(file.id)!)
    } catch (error) {
      if (controller.signal.aborted || currentKey.current !== key) return null
      throw error
    } finally {
      if (active.current === controller) {
        active.current = null
        if (!controller.signal.aborted && currentKey.current === key)
          setLoading(false)
      }
    }
  }, [files, key])

  return { refresh, loading }
}
