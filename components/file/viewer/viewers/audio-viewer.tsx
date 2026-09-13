import { useState } from 'react'

import { ErrorState } from '../components/error-state'
import { LoadingState } from '../components/loading-state'
import { useFileViewer } from '../context'

export function AudioViewer() {
  const { file, state } = useFileViewer()
  const [failedUrl, setFailedUrl] = useState<string>()

  if (!state.urls) return <LoadingState message="Loading audio…" />
  if (failedUrl === state.urls.fileUrl) {
    return <ErrorState error="This audio couldn’t be played in your browser." />
  }

  return (
    <div className="flex w-full items-center justify-center px-4 py-4 sm:px-6">
      <audio
        src={state.urls.fileUrl}
        controls
        aria-label={`${file.name} audio player`}
        className="w-full max-w-2xl"
        controlsList="nodownload"
        preload="metadata"
        onError={() => setFailedUrl(state.urls?.fileUrl)}
      >
        <source src={state.urls.fileUrl} type={file.mimeType} />
        Your browser does not support audio playback. Download the file to
        listen.
      </audio>
    </div>
  )
}
