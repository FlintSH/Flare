'use client'

import { useState } from 'react'

import { FileActions } from '@/components/file/file-actions'
import { AuthGuard } from '@/components/file/protected/auth-guard'
import { FileContent } from '@/components/file/protected/file-content'
import {
  CODE_FILE_TYPES,
  TEXT_FILE_TYPES,
} from '@/components/file/protected/mime-types'

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
  const [codeContent] = useState<string>()

  const isTextBased = Boolean(
    CODE_FILE_TYPES[file.mimeType] ||
      TEXT_FILE_TYPES.includes(file.mimeType) ||
      file.mimeType === 'text/csv'
  )

  return (
    <AuthGuard file={file}>
      {(authGuardVerifiedPassword) => {
        const currentVerifiedPassword =
          authGuardVerifiedPassword || initialVerifiedPassword
        return (
          <div className="space-y-4">
            {}
            <div className="flex items-center justify-center px-2">
              <FileContent
                file={file}
                verifiedPassword={currentVerifiedPassword}
              />
            </div>

            {}
            <div className="flex items-center justify-center px-6 pb-4">
              <FileActions
                urlPath={sanitizeUrl(file.urlPath)}
                name={file.name}
                verifiedPassword={currentVerifiedPassword}
                showOcr={file.mimeType.startsWith('image/')}
                isTextBased={isTextBased}
                content={codeContent}
                fileId={file.id}
              />
            </div>
          </div>
        )
      }}
    </AuthGuard>
  )
}
