'use client'

import { useCallback, useEffect, useState } from 'react'

import { useRouter } from 'next/navigation'

import { UploadIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

import { useFileUpload } from '@/hooks/use-file-upload'
import { useToast } from '@/hooks/use-toast'

interface GlobalDropZoneProps {
  maxSize: number
}

export function GlobalDropZone({ maxSize }: GlobalDropZoneProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [isDragging, setIsDragging] = useState(false)
  const [_dragCounter, setDragCounter] = useState(0)
  const [shouldUpload, setShouldUpload] = useState(false)
  const [droppingInFolder, setDroppingInFolder] = useState(false)
  const { onDrop, uploadFiles, files, isUploading, setFolderId } =
    useFileUpload({
      maxSize,
      onUploadComplete: () => {
        router.refresh()
        window.dispatchEvent(new Event('flare:files-changed'))
        setShouldUpload(false)
      },
      onUploadError: () => setShouldUpload(false),
    })

  const handleDragEnter = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (window.location.pathname.includes('/upload') || isUploading) {
        return
      }

      if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
        const hasFiles = Array.from(e.dataTransfer.items).some(
          (item) => item.kind === 'file'
        )
        if (hasFiles) {
          const folder = new URLSearchParams(window.location.search).get(
            'folder'
          )
          setDroppingInFolder(
            window.location.pathname === '/dashboard' &&
              !!folder &&
              folder !== 'unfiled'
          )
          setDragCounter((prev) => prev + 1)
          setIsDragging(true)
        }
      }
    },
    [isUploading]
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
      if (isUploading) {
        toast({
          title: 'An upload is already in progress',
          description: 'Wait for it to finish, then drop these files again.',
        })
        return
      }

      const validFiles: File[] = []
      const oversizedFiles: File[] = []

      droppedFiles.forEach((file) => {
        if (file.size > maxSize) {
          oversizedFiles.push(file)
        } else {
          validFiles.push(file)
        }
      })

      if (oversizedFiles.length > 0) {
        toast({
          title: 'Files too large',
          description: `${oversizedFiles.length} file(s) exceed the maximum size limit`,
          variant: 'destructive',
        })
      }

      if (validFiles.length > 0) {
        const folder =
          window.location.pathname === '/dashboard'
            ? new URLSearchParams(window.location.search).get('folder')
            : null
        setFolderId(folder === 'unfiled' ? null : folder)
        onDrop(validFiles)
        setShouldUpload(true)
      }
    },
    [isUploading, maxSize, onDrop, setFolderId, toast]
  )

  useEffect(() => {
    if (shouldUpload && files.length > 0 && !isUploading) {
      uploadFiles()
    }
  }, [shouldUpload, files.length, isUploading, uploadFiles])

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
