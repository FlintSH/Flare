'use client'

import DOMPurify from 'dompurify'

interface ImageViewerProps {
  url: string
  alt: string
}

export function ImageViewer({ url, alt }: ImageViewerProps) {
  return (
    <div className="w-full flex items-center justify-center">
      <img
        src={DOMPurify.sanitize(url)}
        alt={alt}
        className="max-w-full max-h-[60vh] object-contain"
      />
    </div>
  )
}
