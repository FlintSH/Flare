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
    return <LoadingState message="Loading video..." />
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
    <div className="flex w-full items-center justify-center bg-muted/20">
      <div className="w-full">
        <video
          src={state.urls.directUrl}
          controls
          aria-label={`${file.name} video player`}
          onError={() => setFailedUrl(state.urls?.directUrl)}
          className="w-full max-h-[65vh] object-contain"
          controlsList="nodownload"
          preload="metadata"
          muted={false}
          playsInline
        >
          <source src={state.urls.directUrl} type={file.mimeType} />
          Your browser does not support the video tag.
        </video>
      </div>
    </div>
  )
}
