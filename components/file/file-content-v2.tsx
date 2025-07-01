'use client'

import { useCallback, useEffect, useState } from 'react'

import DOMPurify from 'dompurify'

import { sanitizeUrl } from '@/lib/utils/url'

import { AudioViewerV2 } from './media-viewers-v2/audio-viewer-v2'
import { CodeViewerV2 } from './media-viewers-v2/code-viewer-v2'
import { CsvViewerV2 } from './media-viewers-v2/csv-viewer-v2'
import { DefaultViewerV2 } from './media-viewers-v2/default-viewer-v2'
import { ImageViewerV2 } from './media-viewers-v2/image-viewer-v2'
import { PdfViewerV2 } from './media-viewers-v2/pdf-viewer-v2'
import { VideoViewerV2 } from './media-viewers-v2/video-viewer-v2'
import {
  AUDIO_FILE_TYPES,
  CODE_FILE_TYPES,
  TEXT_FILE_TYPES,
  VIDEO_FILE_TYPES,
} from './protected/mime-types'

interface FileContentV2Props {
  file: {
    name: string
    urlPath: string
    mimeType: string
  }
  verifiedPassword?: string
}

export function FileContentV2({ file, verifiedPassword }: FileContentV2Props) {
  const [codeContent, setCodeContent] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)
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
    setIsLoading(false)
  }, [file.urlPath, verifiedPassword])

  // Fetch code content for syntax highlighting if needed
  const fetchCodeContent = useCallback(async () => {
    if (CODE_FILE_TYPES[file.mimeType] && !codeContent && fileUrls) {
      try {
        setIsLoading(true)
        const response = await fetch(fileUrls.fileUrl)
        const text = await response.text()
        setCodeContent(text)
      } catch (error) {
        console.error('Failed to fetch code content:', error)
      } finally {
        setIsLoading(false)
      }
    }
  }, [file.mimeType, codeContent, fileUrls])

  // Fetch plain text content
  useEffect(() => {
    if (TEXT_FILE_TYPES.includes(file.mimeType) && !codeContent && fileUrls) {
      setIsLoading(true)
      fetch(fileUrls.fileUrl)
        .then((response) => response.text())
        .then((text) => setCodeContent(text))
        .catch((error) => console.error('Failed to fetch text content:', error))
        .finally(() => setIsLoading(false))
    }
  }, [file.mimeType, codeContent, fileUrls])

  // Call fetchCodeContent when dependencies change
  useEffect(() => {
    if (CODE_FILE_TYPES[file.mimeType] && fileUrls) {
      fetchCodeContent()
    }
  }, [file.mimeType, fileUrls, fetchCodeContent])

  if (!fileUrls) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
          <p className="text-muted-foreground">Loading file...</p>
        </div>
      </div>
    )
  }

  const { fileUrl } = fileUrls

  // Image files
  if (file.mimeType.startsWith('image/')) {
    return <ImageViewerV2 url={fileUrl} alt={file.name} />
  }

  // CSV files
  if (
    file.mimeType.includes('csv') ||
    file.name.toLowerCase().endsWith('.csv')
  ) {
    return (
      <CsvViewerV2
        url={fileUrl}
        title={file.name}
        verifiedPassword={verifiedPassword}
        isLoading={isLoading}
      />
    )
  }

  // PDF files
  if (file.mimeType === 'application/pdf') {
    return <PdfViewerV2 url={fileUrl} title={file.name} />
  }

  // Video files
  if (VIDEO_FILE_TYPES.some((type) => file.mimeType.startsWith(type))) {
    return (
      <VideoViewerV2
        filePath={file.urlPath}
        mimeType={file.mimeType}
        verifiedPassword={verifiedPassword}
        fileName={file.name}
      />
    )
  }

  // Audio files
  if (AUDIO_FILE_TYPES.some((type) => file.mimeType.startsWith(type))) {
    return (
      <AudioViewerV2
        url={fileUrl}
        mimeType={file.mimeType}
        fileName={file.name}
      />
    )
  }

  // Code files
  if (CODE_FILE_TYPES[file.mimeType]) {
    return (
      <CodeViewerV2
        content={codeContent}
        language={CODE_FILE_TYPES[file.mimeType]}
        fileName={file.name}
        isLoading={isLoading}
      />
    )
  }

  // Text files
  if (TEXT_FILE_TYPES.includes(file.mimeType)) {
    return (
      <CodeViewerV2
        content={codeContent}
        language="text"
        fileName={file.name}
        isLoading={isLoading}
      />
    )
  }

  // Default fallback for unsupported file types
  return <DefaultViewerV2 file={file} fileUrl={fileUrl} />
}
