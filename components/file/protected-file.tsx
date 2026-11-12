'use client'

import { useSession } from 'next-auth/react'

import { LoadingState } from '@/components/file/viewer/components/loading-state'
import { FileViewer } from '@/components/file/viewer/file-viewer'
import {
  type FileViewerFile,
  isCompactKind,
} from '@/components/file/viewer/types'

interface ProtectedFileProps {
  file: FileViewerFile
  /** The `password` query the share page was opened with. */
  verifiedPassword?: string
}

/** The preview of a file the share page has already let the visitor see. */
export function ProtectedFile({ file, verifiedPassword }: ProtectedFileProps) {
  const { status } = useSession()

  if (file.visibility === 'PRIVATE' && status === 'loading') {
    return (
      <LoadingState
        message="Checking access…"
        className={isCompactKind(file.kind) ? 'rounded-xl' : 'h-56'}
      />
    )
  }

  return <FileViewer file={file} password={verifiedPassword} />
}
