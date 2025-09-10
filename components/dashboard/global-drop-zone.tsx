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
      setShouldUpload(false)
    },
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
      className={cn(
        'fixed inset-0 z-[100]',
        'bg-black/60 backdrop-blur-md',
        'transition-all duration-500 ease-in-out',
        isDragging
          ? 'opacity-100 pointer-events-auto'
          : 'opacity-0 pointer-events-none'
      )}
    >
      <div className="h-full w-full flex items-center justify-center p-8">
        <div
          className={cn(
            'relative',
            'bg-gradient-to-br from-primary/20 via-primary/10 to-transparent',
            'backdrop-blur-xl',
            'border-4 border-dashed border-primary/50',
            'rounded-3xl p-16 md:p-32',
            'flex flex-col items-center justify-center',
            'transition-all duration-500 ease-out',
            'transform',
            isDragging ? 'scale-100 opacity-100' : 'scale-90 opacity-0',
            'shadow-2xl shadow-primary/20'
          )}
        >
          <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-primary/10 via-transparent to-primary/5 animate-pulse" />

          <div className="relative flex flex-col items-center">
            <div className="relative">
              <UploadIcon className="w-20 h-20 md:w-32 md:h-32 text-primary mb-6" />
              <div className="absolute inset-0 blur-xl bg-primary/30 animate-pulse" />
            </div>

            <h2 className="text-3xl md:text-5xl font-bold bg-gradient-to-br from-primary to-primary/60 bg-clip-text text-transparent mb-3">
              Drop files to upload
            </h2>

            <p className="text-muted-foreground/80 text-center max-w-md text-lg">
              Release to upload files to your account :3
            </p>

            <div className="mt-8 flex gap-2">
              <div
                className="w-2 h-2 rounded-full bg-primary animate-bounce"
                style={{ animationDelay: '0ms' }}
              />
              <div
                className="w-2 h-2 rounded-full bg-primary animate-bounce"
                style={{ animationDelay: '150ms' }}
              />
              <div
                className="w-2 h-2 rounded-full bg-primary animate-bounce"
                style={{ animationDelay: '300ms' }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
