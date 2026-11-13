'use client'

import dynamic from 'next/dynamic'

import { fileUrls } from '@/lib/files/urls'

import { UnsupportedState } from './components/unsupported-state'
import type { FileViewerFile } from './types'

// Each viewer is a chunk of its own, so a share page downloads the code for
// the kind of file it shows and no other: an image brings no code editor, a
// text file no media player. They still render on the server, and the page
// names the one it used so the browser fetches it alongside the rest. None
// takes a `loading` option: that would put a Suspense boundary around the
// viewer, whose fallback would replace the server's markup if anything above
// it updated before the chunk arrived.
const ArchiveViewer = dynamic(() =>
  import('./viewers/archive-viewer').then((module) => module.ArchiveViewer)
)
const AudioViewer = dynamic(() =>
  import('./viewers/audio-viewer').then((module) => module.AudioViewer)
)
const CsvViewer = dynamic(() =>
  import('./viewers/csv-viewer').then((module) => module.CsvViewer)
)
const ImageViewer = dynamic(() =>
  import('./viewers/image-viewer').then((module) => module.ImageViewer)
)
const PdfViewer = dynamic(() =>
  import('./viewers/pdf-viewer').then((module) => module.PdfViewer)
)
const TextContent = dynamic(() =>
  import('./components/text-content').then((module) => module.TextContent)
)
const VideoViewer = dynamic(() =>
  import('./viewers/video-viewer').then((module) => module.VideoViewer)
)

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
      // Not held back like the others: the browser starts on the picture as
      // soon as it reads the page, and the viewer takes it from there.
      return <ImageViewer file={file} src={urls.content} />
    case 'pdf':
      return <PdfViewer name={file.name} src={src} />
    case 'video':
      return <VideoViewer file={file} lookupUrl={urls.direct} />
    case 'audio':
      return <AudioViewer file={file} src={src} />
    case 'csv':
      return (
        <CsvViewer
          url={urls.content}
          bytes={file.size}
          delimiter={file.delimiter}
        />
      )
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
