'use client'

import {
  AUDIO_FILE_TYPES,
  CODE_FILE_TYPES,
  TEXT_FILE_TYPES,
  VIDEO_FILE_TYPES,
} from '../protected/mime-types'
import { ErrorState } from './components/error-state'
import { UnsupportedState } from './components/unsupported-state'
import { useFileViewer } from './context'
import { AudioViewer } from './viewers/audio-viewer'
import { CodeViewer } from './viewers/code-viewer'
import { CsvViewer } from './viewers/csv-viewer'
import { ImageViewer } from './viewers/image-viewer'
import { PdfViewer } from './viewers/pdf-viewer'
import { TextViewer } from './viewers/text-viewer'
import { VideoViewer } from './viewers/video-viewer'

export function FileViewerContent() {
  const { file, state } = useFileViewer()

  if (state.error) {
    return <ErrorState error={state.error} />
  }

  if (file.mimeType.startsWith('image/')) {
    return <ImageViewer />
  }

  if (file.mimeType === 'application/pdf') {
    return <PdfViewer />
  }

  if (VIDEO_FILE_TYPES.some((type) => file.mimeType.startsWith(type))) {
    return <VideoViewer />
  }

  if (AUDIO_FILE_TYPES.some((type) => file.mimeType.startsWith(type))) {
    return <AudioViewer />
  }

  if (
    file.mimeType.includes('csv') ||
    file.name.toLowerCase().endsWith('.csv')
  ) {
    return <CsvViewer />
  }

  if (CODE_FILE_TYPES[file.mimeType]) {
    return <CodeViewer />
  }

  if (TEXT_FILE_TYPES.includes(file.mimeType)) {
    return <TextViewer />
  }

  return <UnsupportedState mimeType={file.mimeType} />
}
