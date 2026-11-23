'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'

import { UploadIcon } from 'lucide-react'

import { folderDestination, libraryHref } from '@/lib/library/contract'
import { allows } from '@/lib/permissions/actions'
import type { PermissionSubject } from '@/lib/permissions/catalog'
import { savedOutcome } from '@/lib/uploads/choices'
import type { SavedUploadSettings } from '@/lib/uploads/saved-settings'
import { uploadTray } from '@/lib/uploads/tray'
import { cn } from '@/lib/utils'

import { useFolders } from '@/hooks/use-folders'
import { useFreshDefaults } from '@/hooks/use-fresh-defaults'
import { usePermissions } from '@/hooks/use-permissions'
import { useToast } from '@/hooks/use-toast'

interface GlobalDropZoneProps {
  maxSize: number
  /** What a plain upload gets, said before the drop. */
  saved: SavedUploadSettings | null
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

export function GlobalDropZone({ maxSize, saved }: GlobalDropZoneProps) {
  const { toast } = useToast()
  const { user } = usePermissions()
  const [isDragging, setIsDragging] = useState(false)
  const [_dragCounter, setDragCounter] = useState(0)
  const [folderId, setFolderId] = useState<string | null>(null)
  const { read: readDefaults, reading } = useFreshDefaults()

  const handleDragEnter = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (window.location.pathname.includes('/upload')) return

      if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
        const hasFiles = Array.from(e.dataTransfer.items).some(
          (item) => item.kind === 'file'
        )
        if (hasFiles) {
          readDefaults()
          setFolderId(dropFolder(window.location, user))
          setDragCounter((prev) => prev + 1)
          setIsDragging(true)
        }
      }
    },
    [user, readDefaults]
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

      if (window.location.pathname.includes('/upload')) {
        return
      }

      const droppedFiles = Array.from(e.dataTransfer?.files || [])
      if (droppedFiles.length === 0) return

      // Into the tab's one upload list, which Upload shows; files dropped
      // while others are going wait their turn.
      const tooLarge = uploadTray().add(droppedFiles, maxSize, {
        options: { folderId: dropFolder(window.location, user) },
      })
      if (tooLarge.length > 0) {
        toast({
          title: 'Files too large',
          description: `${tooLarge.length} file(s) exceed the maximum size limit`,
          variant: 'destructive',
        })
      }
    },
    [maxSize, toast, user]
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

  // Claimed only once the defaults read on opening are in.
  const current = reading ? null : saved
  const outcome = current
    ? savedOutcome(current.effective, allows(user, 'shareFiles'))
    : null

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
          {[
            outcome && (outcome.visibility === 'PUBLIC' ? 'Public' : 'Private'),
            outcome?.expires,
            folderId ? <FolderName key="folder" id={folderId} /> : 'Unfiled',
            current?.profile && `${current.profile.name} profile`,
          ]
            .filter(Boolean)
            .map((part, index) => (
              <Fragment key={index}>
                {index > 0 && ' · '}
                {part}
              </Fragment>
            ))}
        </p>
      </div>
    </div>
  )
}

/**
 * "into" a folder by its name. Only rendered for a folder open in Files,
 * whose list is already loaded there.
 */
export function FolderName({ id }: { id: string }) {
  const { folders } = useFolders()
  return `into ${folders.find((folder) => folder.id === id)?.name ?? 'this folder'}`
}
