'use client'

import { useState } from 'react'

import { RefusedRequest, refusal } from '@/lib/client/request'
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
      if (!response.ok)
        throw await refusal(response, notices.failed.description)
      await saveResponseAsFile(response, `flare-${client.fileName(options)}`)
      toast(notices.ready)
      return true
    } catch (error) {
      console.error(`${client.label} download failed:`, error)
      toast({
        title: notices.failed.title,
        description:
          error instanceof RefusedRequest
            ? error.message
            : notices.failed.description,
        variant: 'destructive',
      })
      return false
    } finally {
      setIsLoading(false)
    }
  }

  return { download, isLoading }
}
