import { useEffect, useState } from 'react'

import { RefusedRequest, apiRequest } from '@/lib/client/request'

import { ErrorState } from '../components/error-state'
import { LoadingState } from '../components/loading-state'

const LOOKUP_FAILED = 'This video couldn’t be loaded.'

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
    return <LoadingState message="Loading video…" />
  }

  if (failedUrl === direct.url) {
    return <ErrorState error="This video couldn’t be played in your browser." />
  }

  return (
    // The same stage between hairlines as images and text: the video uses
    // the card's full width.
    <div className="w-[56rem] min-w-0 max-w-full border-y border-border/60 bg-muted/60 dark:bg-muted/30">
      <video
        src={direct.url}
        controls
        aria-label={`${file.name} video player`}
        onError={() => setFailedUrl(direct.url)}
        className="block max-h-[60vh] w-full object-contain focus-visible:outline-offset-[-2px]"
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
