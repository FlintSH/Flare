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
  refreshKey: number
  libraryFiles: FileType[]
}

export function useImageGallery(
  filters: FileFilterOptions,
  files: FileType[],
  pagination: PaginationInfo,
  refreshKey: number
) {
  const [gallery, setGallery] = useState<GalleryState | null>(null)
  const [navigationPending, setNavigationPending] = useState(false)
  const request = useRef<AbortController | null>(null)
  const navigationStale =
    !!gallery &&
    (gallery.refreshKey !== refreshKey || gallery.libraryFiles !== files)

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
        refreshKey,
        libraryFiles: files,
      })
    },
    [files, pagination, refreshKey]
  )

  const move = useCallback(
    async (direction: -1 | 1) => {
      if (!gallery || request.current) return
      const index = gallery.index + direction
      if (!navigationStale && index >= 0 && index < gallery.files.length) {
        setGallery({ ...gallery, index })
        return
      }
      if (
        !navigationStale &&
        (direction === -1 ? gallery.atStart : gallery.atEnd)
      )
        return

      const controller = new AbortController()
      request.current = controller
      setNavigationPending(true)
      try {
        const next = await adjacentImagePage({
          filters,
          anchorId: gallery.files[gallery.index].id,
          direction,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        if (!next) {
          close()
          toast({
            title: 'This image is no longer in these results',
            description: 'Choose another image from your files.',
          })
          return
        }
        // An empty window means we reached an end. Keep the active image,
        // but discard its outdated neighbors and use its fresh image offset.
        const images = next.files.length
          ? next.files
          : [gallery.files[gallery.index]]
        setGallery({
          files: images,
          pagination: next.pagination,
          index: direction === 1 ? 0 : images.length - 1,
          atStart: next.pagination.offset === 0,
          atEnd:
            next.pagination.offset + images.length >= next.pagination.total,
          // Capture the request's starting revision: a refresh that overlaps
          // this request must still re-anchor the next navigation.
          refreshKey,
          libraryFiles: files,
        })
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
    [filters, gallery, navigationStale, refreshKey, files, close]
  )

  const setIndex = (index: number) =>
    setGallery((previous) => (previous ? { ...previous, index } : previous))

  return {
    gallery,
    open,
    close,
    move,
    setIndex,
    navigationPending,
    navigationStale,
  }
}
