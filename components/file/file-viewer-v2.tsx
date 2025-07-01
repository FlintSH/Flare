'use client'

import { useState } from 'react'

import { ChevronDown, ChevronUp } from 'lucide-react'

import { FileActionsV2 } from '@/components/file/file-actions-v2'
import { FileContentV2 } from '@/components/file/file-content-v2'
import { AuthGuard } from '@/components/file/protected/auth-guard'
import {
  CODE_FILE_TYPES,
  TEXT_FILE_TYPES,
} from '@/components/file/protected/mime-types'
import { Button } from '@/components/ui/button'

import { formatFileSize } from '@/lib/utils'
import { sanitizeUrl } from '@/lib/utils/url'

interface FileViewerV2Props {
  file: {
    id: string
    name: string
    urlPath: string
    visibility: 'PUBLIC' | 'PRIVATE'
    password: string | null
    userId: string
    mimeType: string
    size: number
    uploadedAt: Date
    path: string
    user: {
      name: string
      image?: string
      urlId: string
    }
  }
  verifiedPassword?: string
}

export function FileViewerV2({
  file,
  verifiedPassword: initialVerifiedPassword,
}: FileViewerV2Props) {
  const [showFileInfo, setShowFileInfo] = useState(false)
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
          <div className="min-h-screen bg-background">
            {/* Main content area */}
            <div className="relative">
              <FileContentV2
                file={file}
                verifiedPassword={currentVerifiedPassword}
              />
            </div>

            {/* File info and actions overlay - mobile-first design */}
            <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t shadow-lg z-50">
              {/* Toggle button for file info */}
              <div className="flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowFileInfo(!showFileInfo)}
                  className="rounded-b-none rounded-t-lg border-t border-x"
                >
                  {showFileInfo ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronUp className="h-4 w-4" />
                  )}
                </Button>
              </div>

              {/* File info section */}
              <div
                className={`px-4 py-3 space-y-3 transition-all duration-300 ${
                  showFileInfo
                    ? 'max-h-40 opacity-100'
                    : 'max-h-0 opacity-0 overflow-hidden'
                }`}
              >
                <div className="text-center space-y-1">
                  <h1 className="text-lg font-semibold truncate">
                    {file.name}
                  </h1>
                  <div className="flex justify-center items-center gap-2 text-sm text-muted-foreground">
                    <span>{formatFileSize(file.size)}</span>
                    <span>•</span>
                    <span>{file.mimeType}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Uploaded by {file.user.name} on{' '}
                    {new Date(file.uploadedAt).toLocaleDateString()}
                  </div>
                </div>
              </div>

              {/* Actions section */}
              <div className="px-4 py-3 border-t">
                <FileActionsV2
                  urlPath={sanitizeUrl(file.urlPath)}
                  name={file.name}
                  verifiedPassword={currentVerifiedPassword}
                  showOcr={file.mimeType.startsWith('image/')}
                  isTextBased={isTextBased}
                  content={codeContent}
                  fileId={file.id}
                  mimeType={file.mimeType}
                />
              </div>
            </div>

            {/* Spacer to prevent content being hidden behind overlay */}
            <div className="h-32" />
          </div>
        )
      }}
    </AuthGuard>
  )
}
