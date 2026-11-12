import { useState } from 'react'

import { AudioPlayer } from '@/components/media/audio-player'

import { ErrorState } from '../components/error-state'

export function AudioViewer({
  file,
  src,
}: {
  file: { name: string }
  src?: string
}) {
  const [failedUrl, setFailedUrl] = useState<string>()

  if (src && failedUrl === src) {
    return <ErrorState error="This audio couldn’t be played in your browser." />
  }

  return (
    // The player is on the page from the start, idle until the file's address
    // is known, so it never changes size.
    <AudioPlayer
      src={src}
      name={file.name}
      onError={() => src && setFailedUrl(src)}
    />
  )
}
