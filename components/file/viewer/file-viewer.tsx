'use client'

import { FileViewerProvider } from './context'
import { FileViewerContent } from './file-viewer-content'
import type { FileViewerProps } from './types'

export function FileViewer({ file, verifiedPassword }: FileViewerProps) {
  return (
    <div className="flex items-center justify-center px-2">
      <FileViewerProvider file={file} verifiedPassword={verifiedPassword}>
        <FileViewerContent />
      </FileViewerProvider>
    </div>
  )
}
