'use client'

import DOMPurify from 'dompurify'

interface AudioViewerProps {
  url: string
  mimeType: string
}

export function AudioViewer({ url, mimeType }: AudioViewerProps) {
  return (
    <div className="w-full p-8">
      <audio
        src={DOMPurify.sanitize(url)}
        controls
        className="w-full"
        controlsList="nodownload"
        preload="metadata"
      >
        <source src={DOMPurify.sanitize(url)} type={mimeType} />
        Your browser does not support the audio tag.
      </audio>
    </div>
  )
}
