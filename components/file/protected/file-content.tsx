'use client'

import { useCallback, useEffect, useState } from 'react'

import DOMPurify from 'dompurify'

import { sanitizeUrl } from '@/lib/utils/url'

import { AudioViewer } from './audio-viewer'
import { CodeViewer } from './code-viewer'
import { CsvViewer } from './csv-viewer'
import { ImageViewer } from './image-viewer'
import {
  AUDIO_FILE_TYPES,
  CODE_FILE_TYPES,
  TEXT_FILE_TYPES,
  VIDEO_FILE_TYPES,
} from './mime-types'
import { PdfViewer } from './pdf-viewer'
import { VideoViewer } from './video-viewer'

interface FileContentProps {
  file: {
    name: string
    urlPath: string
    mimeType: string
  }
  verifiedPassword?: string
}

export function FileContent({ file, verifiedPassword }: FileContentProps) {
  const [codeContent, setCodeContent] = useState<string>()
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

  // Fetch code content for syntax highlighting if needed
  const fetchCodeContent = useCallback(async () => {
    if (CODE_FILE_TYPES[file.mimeType] && !codeContent && fileUrls) {
      try {
        const response = await fetch(fileUrls.fileUrl)
        const text = await response.text()
        setCodeContent(text)
      } catch (error) {
        console.error('Failed to fetch code content:', error)
      }
    }
  }, [file.mimeType, codeContent, fileUrls])

  // Fetch plain text content
  useEffect(() => {
    if (TEXT_FILE_TYPES.includes(file.mimeType) && !codeContent && fileUrls) {
      fetch(fileUrls.fileUrl)
        .then((response) => response.text())
        .then((text) => setCodeContent(text))
        .catch((error) => console.error('Failed to fetch text content:', error))
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
      <div className="w-full flex items-center justify-center p-8">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  const { fileUrl } = fileUrls

  // Image files
  if (file.mimeType.startsWith('image/')) {
    return <ImageViewer url={fileUrl} alt={file.name} />
  }

  // CSV files
  if (
    file.mimeType.includes('csv') ||
    file.name.toLowerCase().endsWith('.csv')
  ) {
    return (
      <CsvViewer
        url={fileUrl}
        title={file.name}
        verifiedPassword={verifiedPassword}
      />
    )
  }

  // PDF files
  if (file.mimeType === 'application/pdf') {
    return <PdfViewer url={fileUrl} title={file.name} />
  }

  // Video files
  if (VIDEO_FILE_TYPES.some((type) => file.mimeType.startsWith(type))) {
    return (
      <VideoViewer
        filePath={file.urlPath}
        mimeType={file.mimeType}
        verifiedPassword={verifiedPassword}
      />
    )
  }

  // Audio files
  if (AUDIO_FILE_TYPES.some((type) => file.mimeType.startsWith(type))) {
    return <AudioViewer url={fileUrl} mimeType={file.mimeType} />
  }

  // Code files
  if (CODE_FILE_TYPES[file.mimeType]) {
    if (!codeContent) {
      return (
        <div className="w-full flex items-center justify-center p-8">
          <p className="text-muted-foreground">Loading code content...</p>
        </div>
      )
    }
    return (
      <CodeViewer
        content={codeContent}
        language={CODE_FILE_TYPES[file.mimeType]}
      />
    )
  }

  // Text files
  if (TEXT_FILE_TYPES.includes(file.mimeType)) {
    if (!codeContent) {
      return (
        <div className="w-full flex items-center justify-center p-8">
          <p className="text-muted-foreground">Loading text content...</p>
        </div>
      )
    }
    return <CodeViewer content={codeContent} language="text" />
  }

  // Default fallback for unsupported file types
  return (
    <div className="w-full flex flex-col items-center justify-center p-8 text-center">
      <p className="text-muted-foreground mb-2">
        Preview not available for this file type
      </p>
      <p className="text-sm text-muted-foreground">({file.mimeType})</p>
    </div>
  )
}
