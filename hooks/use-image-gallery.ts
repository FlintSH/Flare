import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  FileFilterOptions,
  FileType,
  PaginationInfo,
} from '@/types/components/file'

import { adjacentImagePage } from '@/lib/files/gallery'

import { toast } from '@/hooks/use-toast'

interface GalleryState {
  files: FileType[]
  pagination: PaginationInfo
  index: number
  atStart: boolean
  atEnd: boolean
}

export function useImageGallery(
  filters: FileFilterOptions,
  files: FileType[],
  pagination: PaginationInfo
) {
  const [gallery, setGallery] = useState<GalleryState | null>(null)
  const [navigationPending, setNavigationPending] = useState(false)
  const request = useRef<AbortController | null>(null)

  const close = useCallback(() => {
    request.current?.abort()
    request.current = null
    setNavigationPending(false)
    setGallery(null)
  }, [])

  useEffect(() => {
    close()
    return () => request.current?.abort()
  }, [filters, close])

  const open = useCallback(
    (file: FileType) => {
      const images = files.filter((entry) =>
        entry.mimeType.startsWith('image/')
      )
      const index = images.findIndex((entry) => entry.id === file.id)
      if (index < 0) return
      request.current?.abort()
      request.current = null
      setNavigationPending(false)
      // Keep this session's page stable when background uploads refresh the
      // grid, which may show a different page from the one being viewed.
      setGallery({
        files: images,
        index,
        pagination,
        atStart: pagination.page <= 1,
        atEnd: pagination.page >= pagination.pageCount,
      })
    },
    [files, pagination]
  )

  const move = useCallback(
    async (direction: -1 | 1) => {
      if (!gallery || request.current) return
      const index = gallery.index + direction
      if (index >= 0 && index < gallery.files.length) {
        setGallery({ ...gallery, index })
        return
      }
      if (direction === -1 ? gallery.atStart : gallery.atEnd) return

      const controller = new AbortController()
      request.current = controller
      setNavigationPending(true)
      try {
        const next = await adjacentImagePage({
          filters,
          page: gallery.pagination.page,
          pageCount: gallery.pagination.pageCount,
          direction,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        if (next) {
          setGallery({
            ...next,
            index: direction === 1 ? 0 : next.files.length - 1,
            atStart: next.pagination.page <= 1,
            atEnd: next.pagination.page >= next.pagination.pageCount,
          })
        } else {
          setGallery({
            ...gallery,
            ...(direction === 1 ? { atEnd: true } : { atStart: true }),
          })
        }
      } catch {
        if (!controller.signal.aborted)
          toast({
            title: 'Couldn’t load the next image',
            description: 'Check your connection and try again.',
            variant: 'destructive',
          })
      } finally {
        if (request.current === controller) {
          request.current = null
          setNavigationPending(false)
        }
      }
    },
    [filters, gallery]
  )

  const setIndex = (index: number) =>
    setGallery((previous) => (previous ? { ...previous, index } : previous))

  return { gallery, open, close, move, setIndex, navigationPending }
}
