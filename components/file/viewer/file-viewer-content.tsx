'use client'

import { fileUrls } from '@/lib/files/urls'

import { TextContent } from './components/text-content'
import { UnsupportedState } from './components/unsupported-state'
import type { FileViewerFile } from './types'
import { ArchiveViewer } from './viewers/archive-viewer'
import { AudioViewer } from './viewers/audio-viewer'
import { CsvViewer } from './viewers/csv-viewer'
import { ImageViewer } from './viewers/image-viewer'
import { PdfViewer } from './viewers/pdf-viewer'
import { VideoViewer } from './viewers/video-viewer'

export function FileViewerContent({
  file,
  password,
  hydrated,
}: {
  file: FileViewerFile
  password?: string
  hydrated: boolean
}) {
  const urls = fileUrls(file, { password })
  const src = hydrated ? urls.content : undefined

  switch (file.kind) {
    case 'archive':
      return (
        <ArchiveViewer
          file={file}
          format={file.archiveFormat}
          password={password}
        />
      )
    case 'unsupported-archive':
      return (
        <UnsupportedState>
          Flare can browse ZIP, TAR, TAR.GZ (TGZ), and GZIP archives. Download
          this one to open it on your device.
        </UnsupportedState>
      )
    case 'image':
      return <ImageViewer file={file} src={src} />
    case 'pdf':
      return <PdfViewer name={file.name} src={src} />
    case 'video':
      return <VideoViewer file={file} lookupUrl={urls.direct} />
    case 'audio':
      return <AudioViewer file={file} src={src} />
    case 'csv':
      return <CsvViewer url={urls.content} bytes={file.size} />
    case 'code':
    case 'text':
      return (
        <TextContent
          name={file.name}
          url={urls.content}
          language={file.language}
          bytes={file.size}
        />
      )
    default:
      return <UnsupportedState />
  }
}
