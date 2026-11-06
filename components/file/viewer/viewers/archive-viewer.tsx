'use client'

import { Archive } from 'lucide-react'

import { ArchiveBrowserContent } from '@/components/archives/archive-browser-content'

import type { ArchiveFormat } from '@/lib/archives/shared'

import type { FileViewerFile } from '../types'

/** `format` is null for an archive Flare can't open. */
export function ArchiveViewer({
  file,
  format,
  password,
}: {
  file: FileViewerFile
  format: ArchiveFormat | null
  password?: string
}) {
  return (
    <section
      aria-labelledby="archive-contents-title"
      className="w-[64rem] min-w-0 max-w-full space-y-3 px-6 pt-1"
    >
      {/* A section label, quieter than the file's name above it. The
          preview panel explains what can be opened. */}
      <h2
        id="archive-contents-title"
        className="flex items-center gap-2 text-sm font-medium"
      >
        <Archive className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
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
