'use client'

import { ErrorState } from './components/error-state'
import { TextContent } from './components/text-content'
import { UnsupportedState } from './components/unsupported-state'
import { useFileViewer } from './context'
import { ArchiveViewer } from './viewers/archive-viewer'
import { AudioViewer } from './viewers/audio-viewer'
import { CsvViewer } from './viewers/csv-viewer'
import { ImageViewer } from './viewers/image-viewer'
import { PdfViewer } from './viewers/pdf-viewer'
import { VideoViewer } from './viewers/video-viewer'

export function FileViewerContent() {
  const { file, state } = useFileViewer()

  if (state.error) {
    return <ErrorState error={state.error} />
  }

  switch (file.kind) {
    case 'archive':
      return <ArchiveViewer format={file.archiveFormat} />
    case 'unsupported-archive':
      return <ArchiveViewer format={null} />
    case 'image':
      return <ImageViewer />
    case 'pdf':
      return <PdfViewer />
    case 'video':
      return <VideoViewer />
    case 'audio':
      return <AudioViewer />
    case 'csv':
      return <CsvViewer />
    case 'code':
    case 'text':
      return <TextContent language={file.language} />
    default:
      return <UnsupportedState mimeType={file.mimeType} />
  }
}
