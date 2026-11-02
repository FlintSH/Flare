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
    // The browser draws the controls, in the theme's colour scheme. The
    // width gives the scrubber room on a card sized to its content.
    <div className="w-[36rem] min-w-0 max-w-full px-6">
      <audio
        src={state.urls.fileUrl}
        controls
        aria-label={`${file.name} audio player`}
        className="block w-full rounded-full focus-visible:outline-offset-[-2px]"
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
