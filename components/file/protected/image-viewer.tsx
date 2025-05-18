'use client'

import DOMPurify from 'dompurify'

interface ImageViewerProps {
  url: string
  alt: string
}

export function ImageViewer({ url, alt }: ImageViewerProps) {
  return (
    <img
      src={DOMPurify.sanitize(url)}
      alt={alt}
      className="max-w-full max-h-[70vh] object-contain"
    />
  )
}
