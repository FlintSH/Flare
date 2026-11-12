import { useState } from 'react'

import { ErrorState } from '../components/error-state'

export function AudioViewer({
  file,
  src,
}: {
  file: { name: string; mimeType: string }
  src?: string
}) {
  const [failedUrl, setFailedUrl] = useState<string>()

  if (src && failedUrl === src) {
    return <ErrorState error="This audio couldn’t be played in your browser." />
  }

  return (
    // The browser draws the controls, in the theme's colour scheme. They are
    // on the page from the start, idle until the file's address is known, so
    // the player never changes size.
    <audio
      src={src}
      controls
      aria-label={`${file.name} audio player`}
      className="block w-full rounded-full focus-visible:outline-offset-[-2px]"
      controlsList="nodownload"
      preload="metadata"
      onError={() => src && setFailedUrl(src)}
    >
      Your browser does not support audio playback. Download the file to listen.
    </audio>
  )
}
