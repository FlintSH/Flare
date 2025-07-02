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
          <div className="space-y-6">
            {/* File content container */}
            <div className="relative rounded-2xl bg-white/10 dark:bg-black/10 backdrop-blur-xl border border-white/20 dark:border-white/10 shadow-lg shadow-black/5 dark:shadow-black/20 overflow-hidden">
              {/* Gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/5 dark:from-white/5 dark:via-transparent dark:to-black/10" />

              {/* File content */}
              <div className="relative bg-black/5 dark:bg-white/5 flex items-center justify-center">
                <FileContent
                  file={file}
                  verifiedPassword={currentVerifiedPassword}
                />
              </div>
            </div>

            {/* Actions section */}
            <div className="relative">
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
