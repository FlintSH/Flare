import { useState } from 'react'

import { AudioLines } from 'lucide-react'

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
    <div className="flex min-h-64 w-full flex-col items-center justify-center gap-6 px-5 py-10 sm:px-8">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-muted/30">
        <AudioLines
          className="h-7 w-7 text-muted-foreground"
          aria-hidden="true"
        />
      </span>
      <audio
        src={state.urls.fileUrl}
        controls
        aria-label={`${file.name} audio player`}
        className="w-full max-w-xl"
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
