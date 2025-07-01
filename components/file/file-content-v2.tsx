'use client'

import { useEffect, useState } from 'react'

import DOMPurify from 'dompurify'
import { FileText, Maximize2, Minimize2 } from 'lucide-react'

import { CodeViewerV2 } from '@/components/file/code-viewer-v2'
import { DocumentViewerV2 } from '@/components/file/document-viewer-v2'
import { MediaViewerV2 } from '@/components/file/media-viewer-v2'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

import { sanitizeUrl } from '@/lib/utils/url'

interface FileContentV2Props {
  file: {
    name: string
    urlPath: string
    mimeType: string
  }
  verifiedPassword?: string
  isFullscreen: boolean
  onToggleFullscreen: (fullscreen: boolean) => void
}

export function FileContentV2({
  file,
  verifiedPassword,
  isFullscreen,
  onToggleFullscreen,
}: FileContentV2Props) {
  const [fileUrls, setFileUrls] = useState<{
    fileUrl: string
    rawUrl: string
  }>()

  // Set up URLs when password changes
  useEffect(() => {
    const fileUrl = DOMPurify.sanitize(
      `/api/files${sanitizeUrl(file.urlPath)}${verifiedPassword ? `?password=${verifiedPassword}` : ''}`
    )
    const rawUrl = DOMPurify.sanitize(
      `${sanitizeUrl(file.urlPath)}/raw${verifiedPassword ? `?password=${verifiedPassword}` : ''}`
    )
    setFileUrls({ fileUrl, rawUrl })
  }, [file.urlPath, verifiedPassword])

  if (!fileUrls) {
    return (
      <Card className="aspect-video flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </Card>
    )
  }

  const isImage = file.mimeType.startsWith('image/')
  const isVideo = file.mimeType.startsWith('video/')
  const isAudio = file.mimeType.startsWith('audio/')
  const isDocument =
    file.mimeType.includes('pdf') || file.mimeType.includes('csv')
  const isCode =
    file.mimeType.includes('json') ||
    file.mimeType.includes('javascript') ||
    file.mimeType.includes('typescript') ||
    file.mimeType.includes('text/')

  return (
    <div
      className={`relative ${isFullscreen ? 'fixed inset-0 z-50 bg-black' : ''}`}
    >
      <Card
        className={`overflow-hidden ${isFullscreen ? 'h-full rounded-none border-0' : 'min-h-[400px]'}`}
      >
        {/* Fullscreen Toggle */}
        <div className="absolute top-4 right-4 z-10">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onToggleFullscreen(!isFullscreen)}
            className="bg-background/80 backdrop-blur-sm"
          >
            {isFullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Content Area */}
        <div
          className={`flex items-center justify-center ${isFullscreen ? 'h-full' : 'min-h-[400px]'} bg-gradient-to-br from-muted/20 to-muted/5`}
        >
          {(isImage || isVideo || isAudio) && (
            <MediaViewerV2
              file={file}
              fileUrl={fileUrls.fileUrl}
              verifiedPassword={verifiedPassword}
              isFullscreen={isFullscreen}
            />
          )}

          {isCode && (
            <CodeViewerV2
              file={file}
              fileUrl={fileUrls.fileUrl}
              isFullscreen={isFullscreen}
            />
          )}

          {isDocument && (
            <DocumentViewerV2
              file={file}
              fileUrl={fileUrls.fileUrl}
              isFullscreen={isFullscreen}
            />
          )}

          {!isImage && !isVideo && !isAudio && !isCode && !isDocument && (
            <div className="text-center p-8">
              <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium mb-2">
                Preview not available
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                This file type ({file.mimeType}) cannot be previewed
              </p>
              <Button
                onClick={() => window.open(fileUrls.rawUrl, '_blank')}
                variant="outline"
              >
                Open in new tab
              </Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
