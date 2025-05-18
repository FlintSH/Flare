'use client'

import DOMPurify from 'dompurify'

interface PdfViewerProps {
  url: string
  title: string
}

export function PdfViewer({ url, title }: PdfViewerProps) {
  return (
    <div className="w-full">
      <iframe
        src={DOMPurify.sanitize(url)}
        className="w-full h-[80vh]"
        title={title}
      />
    </div>
  )
}
