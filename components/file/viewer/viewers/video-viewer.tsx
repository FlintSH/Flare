import { useEffect, useState } from 'react'

import { RefusedRequest, apiRequest } from '@/lib/client/request'
import { cn } from '@/lib/utils'

import { ErrorState } from '../components/error-state'
import {
  LoadingState,
  stageMaxHeightClassName,
} from '../components/loading-state'

const LOOKUP_FAILED = 'This video couldn’t be loaded.'

/** The frame held for a video until it reports its own. */
const DEFAULT_RATIO = 16 / 9

/** `lookupUrl` answers with where the video plays from. */
export function VideoViewer({
  file,
  lookupUrl,
}: {
  file: { name: string; mimeType: string }
  lookupUrl: string
}) {
  const [direct, setDirect] = useState<{ url?: string; error?: string }>({})
  const [failedUrl, setFailedUrl] = useState<string>()
  const [ratio, setRatio] = useState(DEFAULT_RATIO)

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
    // own, so a 16:9 video starts without moving the page. Bars beside a
    // narrower video are black in both themes, like the player's own.
    <div className="w-full bg-black">
      <video
        src={direct.url}
        controls
        aria-label={`${file.name} video player`}
        onLoadedMetadata={({ currentTarget: video }) => {
          if (video.videoWidth && video.videoHeight)
            setRatio(video.videoWidth / video.videoHeight)
        }}
        onError={() => setFailedUrl(direct.url)}
        className={cn(
          'mx-auto block w-full object-contain focus-visible:outline-offset-[-2px]',
          stageMaxHeightClassName
        )}
        style={{ aspectRatio: ratio }}
        controlsList="nodownload"
        preload="metadata"
        muted={false}
        playsInline
      >
        <source src={direct.url} type={file.mimeType} />
        Your browser does not support the video tag.
      </video>
    </div>
  )
}
