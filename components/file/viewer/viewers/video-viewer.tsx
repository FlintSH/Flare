import { useEffect, useState } from 'react'

import { ErrorState } from '../components/error-state'
import { LoadingState } from '../components/loading-state'
import { useFileViewer } from '../context'

export function VideoViewer() {
  const { file, state, fetchDirectUrl } = useFileViewer()
  const [failedUrl, setFailedUrl] = useState<string>()

  useEffect(() => {
    fetchDirectUrl()
  }, [fetchDirectUrl])

  if (state.isLoading) {
    return <LoadingState message="Loading video…" />
  }

  if (state.error) {
    return <ErrorState error={state.error} />
  }

  if (!state.urls?.directUrl) {
    return <LoadingState message="Loading video…" />
  }

  if (failedUrl === state.urls.directUrl) {
    return <ErrorState error="This video couldn’t be played in your browser." />
  }

  return (
    // The same stage between hairlines as images and text: the video uses
    // the card's full width.
    <div className="w-[56rem] min-w-0 max-w-full border-y border-border/60 bg-muted/60 dark:bg-muted/30">
      <video
        src={state.urls.directUrl}
        controls
        aria-label={`${file.name} video player`}
        onError={() => setFailedUrl(state.urls?.directUrl)}
        className="block max-h-[60vh] w-full object-contain focus-visible:outline-offset-[-2px]"
        controlsList="nodownload"
        preload="metadata"
        muted={false}
        playsInline
      >
        <source src={state.urls.directUrl} type={file.mimeType} />
        Your browser does not support the video tag.
      </video>
    </div>
  )
}
