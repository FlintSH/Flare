'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'

import { useRouter } from 'next/navigation'

import { useQueryClient } from '@tanstack/react-query'

import { useAccountKeyState } from '@/components/providers/account-keys-provider'
import { ToastAction } from '@/components/ui/toast'

import { libraryChanged } from '@/lib/library/changes'
import type { UploadOptions, UploadResponse } from '@/lib/uploads/client'
import { type UploadBatch, createUploadQueue } from '@/lib/uploads/queue'

import { toast } from '@/hooks/use-toast'
import { useUploadLibrary } from '@/hooks/use-upload-library'

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

/**
 * The account public key that browser uploads are encrypted for
 * (docs/e2ee-spec.md, section 10.1). It comes from the unlocked keys of
 * this browser, never from a server answer alone. While the keys are locked
 * an encrypted upload cannot start.
 */
export function useUploadEncryption() {
  const state = useAccountKeyState()
  return {
    locked: state.status === 'locked',
    loading: state.status === 'loading',
    encryptFor:
      state.status === 'unlocked' ? state.keys.accountPublicKey : undefined,
  }
}

function notifyKeysLocked() {
  toast({
    title: 'Unlock your encryption keys first',
    description:
      'Files are encrypted in this browser before they are sent. Unlock with your passphrase, then upload again.',
    variant: 'destructive',
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
  const encryption = useUploadEncryption()
  const libraryFor = useUploadLibrary()
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
    else if (batch.failure.cancelled)
      toast({
        title: 'Upload cancelled',
        description: batch.uploaded.length
          ? `${batch.uploaded.length} ${batch.uploaded.length === 1 ? 'file was' : 'files were'} already uploaded.`
          : 'Nothing was uploaded.',
      })
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

  /** The options with the account key to encrypt for, or null when the keys are locked. */
  const prepared = (
    options: UploadOptions,
    plain: boolean | undefined
  ): UploadOptions | null => {
    const library = libraryFor(options)
    if (plain) return { ...options, library }
    if (!encryption.encryptFor) {
      notifyKeysLocked()
      return null
    }
    return { ...options, library, encryptFor: encryption.encryptFor }
  }

  const uploadFiles = async (
    batch: readonly File[],
    options: UploadOptions,
    { plain }: { plain?: boolean } = {}
  ): Promise<UploadBatch | null> => {
    if (queue.getState().uploading) {
      notifyUploadInProgress()
      return null
    }
    const ready = prepared(options, plain)
    if (!ready) return null
    return settle(await queue.uploadFiles(batch, ready), (remaining) => {
      void uploadFiles(remaining, options, { plain })
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
    /**
     * Sends the queued files; the ones that weren't sent stay queued. Files
     * are encrypted in this browser unless `plain` is set.
     */
    upload: async (
      options: UploadOptions,
      { plain }: { plain?: boolean } = {}
    ) => {
      const ready = prepared(options, plain)
      return ready ? settle(await queue.upload(ready)) : null
    },
    /** Stops the upload in progress. */
    cancel: queue.cancel,
    /** Sends these files as one batch; a failure offers Retry instead of queueing them. */
    uploadFiles,
  }
}
