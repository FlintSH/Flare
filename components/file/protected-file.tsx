'use client'

import { useSession } from 'next-auth/react'

import { FileActions } from '@/components/file/file-actions'
import { LoadingState } from '@/components/file/viewer/components/loading-state'
import { FileViewer } from '@/components/file/viewer/file-viewer'
import type { FileViewerFile } from '@/components/file/viewer/types'

import { isTextKind } from '@/lib/files/file-kind'

interface ProtectedFileProps {
  file: FileViewerFile
  /** The `password` query the share page was opened with. */
  verifiedPassword?: string
}

/** A file the share page has already let the visitor see. */
export function ProtectedFile({ file, verifiedPassword }: ProtectedFileProps) {
  const { status } = useSession()

  if (file.visibility === 'PRIVATE' && status === 'loading') {
    return <LoadingState message="Checking access…" />
  }

  return (
    <div className="min-w-0 space-y-4">
      <FileViewer file={file} password={verifiedPassword} />

      <div className="flex items-center justify-center px-6 pb-4">
        <FileActions
          file={file}
          verifiedPassword={verifiedPassword}
          showOcr={file.kind === 'image'}
          isTextBased={isTextKind(file.kind)}
        />
      </div>
    </div>
  )
}
