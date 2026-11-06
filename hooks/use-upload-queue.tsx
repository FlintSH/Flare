'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'

import { useRouter } from 'next/navigation'

import { useQueryClient } from '@tanstack/react-query'

import { ToastAction } from '@/components/ui/toast'

import { libraryChanged } from '@/lib/library/changes'
import type { UploadOptions, UploadResponse } from '@/lib/uploads/client'
import { type UploadBatch, createUploadQueue } from '@/lib/uploads/queue'

import { toast } from '@/hooks/use-toast'

/** Copies upload links and says whether that worked. */
export async function copyUploadLinks(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast({ title: 'Copied to clipboard' })
    return true
  } catch {
    toast({
      title: 'Could not copy link',
      description: 'Open the file to copy its address.',
      variant: 'destructive',
    })
    return false
  }
}

/** A queue sends one batch at a time. */
export function notifyUploadInProgress() {
  toast({
    title: 'An upload is already in progress',
    description: 'Wait for it to finish, then drop these files again.',
  })
}

const link = (file: UploadResponse) => file.pageUrl || file.url

function notifyUploaded(files: readonly UploadResponse[]) {
  if (files.length === 1) {
    const [file] = files
    toast({
      title: 'Upload complete',
      description: `Successfully uploaded ${file.name}`,
      action: (
        <div className="flex gap-2">
          <ToastAction
            altText="Open file"
            onClick={() =>
              window.open(link(file), '_blank', 'noopener,noreferrer')
            }
          >
            Open
          </ToastAction>
          <ToastAction
            altText="Copy link"
            onClick={() => copyUploadLinks(link(file))}
          >
            Copy link
          </ToastAction>
        </div>
      ),
    })
    return
  }
  toast({
    title: 'Upload complete',
    description: `Successfully uploaded ${files.length} files`,
    action: (
      <ToastAction
        altText="Copy all links"
        onClick={() => {
          void copyUploadLinks(files.map(link).join('\n'))
        }}
      >
        Copy all links
      </ToastAction>
    ),
  })
}

/**
 * An upload queue with what every uploader shows when a batch ends: the links
 * or the failure, and a library refresh when anything arrived. Progress shows
 * in `UploadProgress`.
 */
export function useUploadQueue() {
  const [queue] = useState(() => createUploadQueue())
  const { files, uploading } = useSyncExternalStore(
    queue.subscribe,
    queue.getState,
    queue.getState
  )
  const router = useRouter()
  const client = useQueryClient()
  useEffect(() => queue.dispose, [queue])

  const settle = (
    batch: UploadBatch | null,
    retry?: (files: readonly File[]) => void
  ) => {
    if (!batch) return null
    if (batch.uploaded.length) {
      void libraryChanged(client)
      router.refresh()
    }
    if (!batch.failure) notifyUploaded(batch.uploaded)
    else {
      const { message, remaining } = batch.failure
      toast({
        title: 'Upload failed',
        description: message,
        variant: 'destructive',
        ...(retry && {
          action: (
            <ToastAction
              altText="Drop the files again to retry."
              onClick={() => retry(remaining)}
            >
              Retry
            </ToastAction>
          ),
        }),
      })
    }
    return batch
  }

  const uploadFiles = async (
    batch: readonly File[],
    options: UploadOptions
  ): Promise<UploadBatch | null> => {
    if (queue.getState().uploading) {
      notifyUploadInProgress()
      return null
    }
    return settle(await queue.uploadFiles(batch, options), (remaining) => {
      void uploadFiles(remaining, options)
    })
  }

  return {
    files,
    uploading,
    /** Queues files within the maximum size; returns the files over it. */
    add: (selected: readonly File[], maxSize: number) =>
      queue.add(selected, maxSize),
    remove: queue.remove,
    clear: queue.clear,
    /** Sends the queued files; the ones that weren't sent stay queued. */
    upload: async (options: UploadOptions) =>
      settle(await queue.upload(options)),
    /** Sends these files as one batch; a failure offers Retry instead of queueing them. */
    uploadFiles,
  }
}
