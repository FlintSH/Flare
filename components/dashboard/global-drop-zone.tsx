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
  const { onDrop, uploadFiles, files, isUploading } = useFileUpload({
    maxSize,
    onUploadComplete: () => {
      router.refresh()
      window.dispatchEvent(new Event('flare:files-changed'))
      setShouldUpload(false)
    },
    onUploadError: () => setShouldUpload(false),
  })

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (window.location.pathname.includes('/upload')) {
      return
    }

    if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
      const hasFiles = Array.from(e.dataTransfer.items).some(
        (item) => item.kind === 'file'
      )
      if (hasFiles) {
        setDragCounter((prev) => prev + 1)
        setIsDragging(true)
      }
    }
  }, [])

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
        onDrop(validFiles)
        setShouldUpload(true)
      }
    },
    [maxSize, onDrop, toast]
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
      <div className="w-full max-w-xl rounded-3xl border-2 border-dashed border-primary/50 bg-card p-8 text-center shadow-xl sm:p-14">
        <span className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-muted/50">
          <UploadIcon className="h-7 w-7" aria-hidden="true" />
        </span>
        <p className="mb-3 text-[11px] font-medium uppercase tracking-[.2em] text-muted-foreground">
          Ready when you are
        </p>
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Drop files to upload
        </h2>
        <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
          Release to upload using your account’s default upload profile. Your
          files will appear in your library.
        </p>
      </div>
    </div>
  )
}
