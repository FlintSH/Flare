'use client'

import { Archive } from 'lucide-react'

import { ArchiveBrowserContent } from '@/components/archives/archive-browser-content'

import { useFileViewer } from '../context'

export function ArchiveViewer() {
  const { file, verifiedPassword } = useFileViewer()

  return (
    <section
      aria-label="Archive contents"
      className="w-[64rem] min-w-0 max-w-full space-y-5 p-4 sm:p-6"
    >
      <div className="space-y-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Archive className="h-5 w-5 text-primary" aria-hidden="true" />
          Archive contents
        </h2>
        <p className="text-sm text-muted-foreground">
          Browse folders, preview files, or download individual entries.
        </p>
      </div>
      <ArchiveBrowserContent
        key={file.id}
        file={file}
        source={{ kind: 'share', password: verifiedPassword }}
      />
    </section>
  )
}
