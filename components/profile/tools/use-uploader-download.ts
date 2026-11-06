'use client'

import { useState } from 'react'

import {
  type UploaderClientId,
  type UploaderOptions,
  uploaderClientRequest,
  uploaderClients,
} from '@/lib/uploads/uploader-clients'

import { useToast } from '@/hooks/use-toast'

import { saveResponseAsFile } from './save-response-as-file'

interface Notice {
  title: string
  description: string
}

/** A refusal whose message the server wrote for the person. */
class RefusedDownload extends Error {}

async function refusal(response: Response) {
  const body: unknown = await response.json().catch(() => null)
  const message =
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof body.error === 'string'
      ? body.error
      : ''
  return new RefusedDownload(message)
}

/**
 * Downloads a client's file and saves it under the server's filename. The
 * tool's own notices announce the result; a failure shows the server's reason
 * when it gives one.
 */
export function useUploaderDownload<Id extends UploaderClientId>(
  id: Id,
  notices: { ready: Notice; failed: Notice }
) {
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()

  /** Resolves to whether the file was saved. */
  async function download(options: UploaderOptions<Id>, profileId?: string) {
    const client = uploaderClients[id]
    setIsLoading(true)
    try {
      const response = await fetch(
        ...uploaderClientRequest(id, options, profileId)
      )
      if (!response.ok) throw await refusal(response)
      await saveResponseAsFile(response, `flare-${client.fileName(options)}`)
      toast(notices.ready)
      return true
    } catch (error) {
      console.error(`${client.label} download failed:`, error)
      toast({
        title: notices.failed.title,
        description:
          (error instanceof RefusedDownload && error.message) ||
          notices.failed.description,
        variant: 'destructive',
      })
      return false
    } finally {
      setIsLoading(false)
    }
  }

  return { download, isLoading }
}
