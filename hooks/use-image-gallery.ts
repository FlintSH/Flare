import { useCallback, useEffect, useRef, useState } from 'react'

import type { FileType } from '@/types/components/file'

import type { LibraryFilters } from '@/lib/library/contract'
import { type GalleryPage, adjacentImagePage } from '@/lib/library/gallery'

import { toast } from '@/hooks/use-toast'

interface GalleryState {
  files: FileType[]
  /** Where `files` sit among the filtered images; null until a window loads. */
  pagination: GalleryPage['pagination'] | null
  index: number
  atStart: boolean
  atEnd: boolean
  refreshKey: number
  libraryFiles: FileType[]
}

/**
 * The full-screen viewer. It opens on one image and loads its neighbors by ID,
 * so it pages through every image the filters match, not only loaded cards.
 */
export function useImageGallery(
  filters: LibraryFilters,
  files: FileType[],
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
      request.current?.abort()
      request.current = null
      setNavigationPending(false)
      // The viewer keeps its own images, so a background refresh of the grid
      // doesn't move it.
      setGallery({
        files: [file],
        index: 0,
        pagination: null,
        atStart: false,
        atEnd: false,
        refreshKey,
        libraryFiles: files,
      })
    },
    [files, refreshKey]
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
