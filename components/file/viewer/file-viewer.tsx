'use client'

import { FileViewerProvider } from './context'
import { FileViewerContent } from './file-viewer-content'
import type { FileViewerProps } from './types'

export function FileViewer({ file, verifiedPassword }: FileViewerProps) {
  return (
    <div className="flex min-w-0 items-center justify-center overflow-hidden">
      <FileViewerProvider file={file} verifiedPassword={verifiedPassword}>
        <FileViewerContent />
      </FileViewerProvider>
    </div>
  )
}
