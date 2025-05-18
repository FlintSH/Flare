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

export function ProtectedFile({ file, verifiedPassword }: ProtectedFileProps) {
  const [codeContent] = useState<string>()

  const isTextBased = Boolean(
    CODE_FILE_TYPES[file.mimeType] ||
      TEXT_FILE_TYPES.includes(file.mimeType) ||
      file.mimeType === 'text/csv'
  )

  return (
    <AuthGuard file={file}>
      {/* File content */}
      <div className="bg-black/5 dark:bg-white/5 flex items-center justify-center">
        <FileContent file={file} />
      </div>

      {/* Actions */}
      <div className="p-6 border-t bg-muted/50">
        <FileActions
          urlPath={sanitizeUrl(file.urlPath)}
          name={file.name}
          verifiedPassword={verifiedPassword}
          showOcr={file.mimeType.startsWith('image/')}
          isTextBased={isTextBased}
          content={codeContent}
          fileId={file.id}
        />
      </div>
    </AuthGuard>
  )
}
