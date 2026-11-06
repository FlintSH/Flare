'use client'

import { useCallback, useEffect, useState } from 'react'

import { UploadIcon } from 'lucide-react'

import { folderDestination, libraryHref } from '@/lib/library/contract'
import { allows } from '@/lib/permissions/actions'
import type { PermissionSubject } from '@/lib/permissions/catalog'
import { partitionBySize } from '@/lib/uploads/client'
import { cn } from '@/lib/utils'

import { usePermissions } from '@/hooks/use-permissions'
import { useToast } from '@/hooks/use-toast'
import {
  notifyUploadInProgress,
  useUploadQueue,
} from '@/hooks/use-upload-queue'

interface GlobalDropZoneProps {
  maxSize: number
}

/**
 * The folder open in Files, which a drop uploads into when the role may save
 * new files into folders. The server refuses folder destinations otherwise.
 */
export function dropFolder(
  location: { pathname: string; search: string },
  user: PermissionSubject | null | undefined
) {
  if (!allows(user, 'fileIntoFolder') || location.pathname !== libraryHref())
    return null
  return folderDestination(new URLSearchParams(location.search).get('folder'))
}

export function GlobalDropZone({ maxSize }: GlobalDropZoneProps) {
  const { toast } = useToast()
  const { user } = usePermissions()
  const [isDragging, setIsDragging] = useState(false)
  const [_dragCounter, setDragCounter] = useState(0)
  const [droppingInFolder, setDroppingInFolder] = useState(false)
  // Each drop is its own batch: nothing waits in a queue for the next drop.
  const { uploading, uploadFiles } = useUploadQueue()

  const handleDragEnter = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (window.location.pathname.includes('/upload') || uploading) {
        return
      }

      if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
        const hasFiles = Array.from(e.dataTransfer.items).some(
          (item) => item.kind === 'file'
        )
        if (hasFiles) {
          setDroppingInFolder(!!dropFolder(window.location, user))
          setDragCounter((prev) => prev + 1)
          setIsDragging(true)
        }
      }
    },
    [uploading, user]
  )

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

    setDragCounter((prev) => {
      const newCounter = prev - 1
      if (newCounter === 0) {
        setIsDragging(false)
      }
      return newCounter
    })
  }, [])

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()

      setDragCounter(0)
      setIsDragging(false)

      // Skip handling if on upload page
      if (window.location.pathname.includes('/upload')) {
        return
      }

      const droppedFiles = Array.from(e.dataTransfer?.files || [])
      if (droppedFiles.length === 0) return
      if (uploading) {
        notifyUploadInProgress()
        return
      }

      const { fitting, tooLarge } = partitionBySize(droppedFiles, maxSize)

      if (tooLarge.length > 0) {
        toast({
          title: 'Files too large',
          description: `${tooLarge.length} file(s) exceed the maximum size limit`,
          variant: 'destructive',
        })
      }

      if (fitting.length > 0)
        await uploadFiles(fitting, {
          folderId: dropFolder(window.location, user),
        })
    },
    [uploading, maxSize, uploadFiles, toast, user]
  )

  useEffect(() => {
    document.addEventListener('dragenter', handleDragEnter)
    document.addEventListener('dragleave', handleDragLeave)
    document.addEventListener('dragover', handleDragOver)
    document.addEventListener('drop', handleDrop)

    return () => {
      document.removeEventListener('dragenter', handleDragEnter)
      document.removeEventListener('dragleave', handleDragLeave)
      document.removeEventListener('dragover', handleDragOver)
      document.removeEventListener('drop', handleDrop)
    }
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop])

  return (
    <div
      aria-hidden={!isDragging}
      className={cn(
        'fixed inset-0 z-[100] flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm transition-opacity motion-reduce:transition-none',
        isDragging
          ? 'pointer-events-auto opacity-100'
          : 'pointer-events-none invisible opacity-0'
      )}
    >
      <div className="w-full max-w-2xl rounded-2xl border-2 border-dashed border-primary/50 bg-background/80 p-8 text-center shadow-xl backdrop-blur-xl sm:p-12">
        <UploadIcon
          className="mx-auto mb-6 h-16 w-16 text-primary"
          aria-hidden="true"
        />
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Drop files to upload
        </h2>
        <p className="mt-3 text-muted-foreground">
          {droppingInFolder
            ? 'Release to upload into this folder with your default upload profile.'
            : 'Release to upload with your default upload profile.'}
        </p>
      </div>
    </div>
  )
}
