import { useEffect } from 'react'

import { ErrorState } from '../components/error-state'
import { LoadingState } from '../components/loading-state'
import { useFileViewer } from '../context'

export function VideoViewer() {
  const { file, state, fetchDirectUrl } = useFileViewer()

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
    return <ErrorState error="Failed to load video" />
  }

  return (
    <div className="w-full flex items-center justify-center">
      <div className="w-full max-w-4xl">
        <video
          src={state.urls.directUrl}
          controls
          className="w-full max-h-[60vh] object-contain"
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
