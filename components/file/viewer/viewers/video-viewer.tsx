import { useEffect, useState } from 'react'

import { VideoPlayer } from '@/components/media/video-player'

import { RefusedRequest, apiRequest } from '@/lib/client/request'
import { cn } from '@/lib/utils'

import { ErrorState } from '../components/error-state'
import {
  LoadingState,
  stageMaxHeightClassName,
} from '../components/loading-state'

const LOOKUP_FAILED = 'This video couldn’t be loaded.'

/** `lookupUrl` answers with where the video plays from. */
export function VideoViewer({
  file,
  lookupUrl,
}: {
  file: { name: string }
  lookupUrl: string
}) {
  const [direct, setDirect] = useState<{ url?: string; error?: string }>({})
  const [failedUrl, setFailedUrl] = useState<string>()

  useEffect(() => {
    const controller = new AbortController()
    setDirect({})
    apiRequest<{ url?: string }>(lookupUrl, {
      signal: controller.signal,
      fallback: LOOKUP_FAILED,
    }).then(
      ({ url }) => {
        if (!controller.signal.aborted) setDirect({ url })
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setDirect({
            error:
              error instanceof RefusedRequest ? error.message : LOOKUP_FAILED,
          })
      }
    )
    return () => controller.abort()
  }, [lookupUrl])

  if (direct.error) {
    return <ErrorState error={direct.error} />
  }

  if (!direct.url) {
    return (
      <LoadingState
        message="Loading video…"
        className={cn('aspect-video', stageMaxHeightClassName)}
      />
    )
  }

  if (failedUrl === direct.url) {
    return <ErrorState error="This video couldn’t be played in your browser." />
  }

  return (
    // The player keeps the loading frame's shape until the video reports its
    // own, so a 16:9 video starts without moving the page.
    <VideoPlayer
      src={direct.url}
      name={file.name}
      onError={() => setFailedUrl(direct.url)}
      className={stageMaxHeightClassName}
    />
  )
}
