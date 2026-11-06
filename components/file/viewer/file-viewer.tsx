'use client'

import { useEffect, useState } from 'react'

import { FileViewerContent } from './file-viewer-content'
import type { FileViewerFile } from './types'

interface FileViewerProps {
  file: FileViewerFile
  /** Sent with every request for the file's content. */
  password?: string
}

export function FileViewer({ file, password }: FileViewerProps) {
  // Images, PDFs and audio load once hydrated, so an image can't finish
  // loading before React handles its onLoad, which sizes it on its stage.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])

  return (
    <div className="flex min-w-0 items-center justify-center overflow-hidden">
      <FileViewerContent file={file} password={password} hydrated={hydrated} />
    </div>
  )
}
