'use client'

import { FileActions } from '@/components/file/file-actions'
import { AuthGuard } from '@/components/file/protected/auth-guard'
import {
  CODE_FILE_TYPES,
  TEXT_FILE_TYPES,
} from '@/components/file/protected/mime-types'
import { FileViewer } from '@/components/file/viewer'

import { sanitizeUrl } from '@/lib/utils/url'

interface ProtectedFileProps {
  file: {
    id: string
    name: string
    urlPath: string
    visibility: 'PUBLIC' | 'PRIVATE'
    password: string | null
    userId: string
    mimeType: string
  }
  verifiedPassword?: string
}

export function ProtectedFile({
  file,
  verifiedPassword: initialVerifiedPassword,
}: ProtectedFileProps) {
  const isTextBased = Boolean(
    CODE_FILE_TYPES[file.mimeType] ||
    TEXT_FILE_TYPES.includes(file.mimeType) ||
    file.mimeType === 'text/csv'
  )

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

            <div className="flex items-center justify-center px-4 pb-4 sm:px-6">
              <FileActions
                urlPath={sanitizeUrl(file.urlPath)}
                name={file.name}
                verifiedPassword={currentVerifiedPassword}
                showOcr={file.mimeType.startsWith('image/')}
                isTextBased={isTextBased}
                fileId={file.id}
              />
            </div>
          </div>
        )
      }}
    </AuthGuard>
  )
}
