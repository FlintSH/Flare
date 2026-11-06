'use client'

import { FileActions } from '@/components/file/file-actions'
import { AuthGuard } from '@/components/file/protected/auth-guard'
import { FileViewer } from '@/components/file/viewer'
import type { FileViewerFile } from '@/components/file/viewer/types'

import { isTextKind } from '@/lib/files/file-kind'

interface ProtectedFileProps {
  file: FileViewerFile
  verifiedPassword?: string
}

export function ProtectedFile({
  file,
  verifiedPassword: initialVerifiedPassword,
}: ProtectedFileProps) {
  return (
    <AuthGuard file={file} initialVerifiedPassword={initialVerifiedPassword}>
      {(authGuardVerifiedPassword) => {
        const currentVerifiedPassword =
          authGuardVerifiedPassword || initialVerifiedPassword
        return (
          <div className="min-w-0 space-y-4">
            <FileViewer
              file={file}
              verifiedPassword={currentVerifiedPassword}
            />

            <div className="flex items-center justify-center px-6 pb-4">
              <FileActions
                file={file}
                verifiedPassword={currentVerifiedPassword}
                showOcr={file.kind === 'image'}
                isTextBased={isTextKind(file.kind)}
              />
            </div>
          </div>
        )
      }}
    </AuthGuard>
  )
}
