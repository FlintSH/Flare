import React from 'react'

import {
  Archive,
  File,
  FileCode,
  FileText,
  Image as ImageIcon,
  Music,
  Table,
  Video,
} from 'lucide-react'

export function getFileIcon(mimeType: string, className?: string) {
  if (mimeType.startsWith('image/')) return <ImageIcon className={className} />
  if (mimeType.startsWith('video/')) return <Video className={className} />
  if (mimeType.startsWith('audio/')) return <Music className={className} />
  if (mimeType === 'application/pdf') return <FileText className={className} />

  if (
    mimeType.includes('javascript') ||
    mimeType.includes('typescript') ||
    mimeType.includes('python') ||
    mimeType.includes('java') ||
    mimeType.includes('php') ||
    mimeType.includes('ruby') ||
    mimeType.includes('go') ||
    mimeType.includes('rust') ||
    mimeType.includes('html') ||
    mimeType.includes('css')
  ) {
    return <FileCode className={className} />
  }

  if (
    mimeType.includes('csv') ||
    mimeType.includes('spreadsheet') ||
    mimeType.includes('excel') ||
    mimeType.includes('numbers')
  ) {
    return <Table className={className} />
  }

  if (
    mimeType.includes('zip') ||
    mimeType.includes('tar') ||
    mimeType.includes('rar') ||
    mimeType.includes('7z') ||
    mimeType.includes('gzip')
  ) {
    return <Archive className={className} />
  }

  if (
    mimeType.startsWith('text/') ||
    mimeType.includes('json') ||
    mimeType.includes('xml')
  ) {
    return <FileText className={className} />
  }

  return <File className={className} />
}
