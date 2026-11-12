'use client'

import { ArchiveBrowserContent } from '@/components/archives/archive-browser-content'

import type { ArchiveFormat } from '@/lib/archives/shared'

import type { FileViewerFile } from '../types'

/** An archive Flare can browse. The file's header already says what it is. */
export function ArchiveViewer({
  file,
  format,
  password,
}: {
  file: FileViewerFile
  format: ArchiveFormat
  password?: string
}) {
  return (
    <section
      aria-labelledby="archive-contents-title"
      className="w-full min-w-0 p-4 sm:p-5"
    >
      <h2 id="archive-contents-title" className="sr-only">
        Archive contents
      </h2>
      <ArchiveBrowserContent
        key={file.id}
        file={file}
        format={format}
        source={{ kind: 'share', password }}
      />
    </section>
  )
}
