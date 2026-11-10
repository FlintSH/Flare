'use client'

import { useMemo } from 'react'

import { Archive } from 'lucide-react'

import { detectArchiveFormat } from '@/lib/archives/shared'
import type { OpenedFile } from '@/lib/e2ee/client/files'
import { normalizedType, safeFileName } from '@/lib/files/safe-render'

import { ArchiveBrowserContent } from './archive-browser-content'
import type { ArchiveSource } from './archive-utils'
import { useEncryptedArchive } from './encrypted-archive-handle'

/**
 * The contents of an encrypted archive on its share page
 * (docs/e2ee-spec.md, section 12.3). The visitor's browser lists it and
 * opens entries with the key of the link. The server is asked only for
 * byte ranges of the ciphertext, and gives no unlock cookie.
 */
export function EncryptedArchiveViewer({
  file,
  opened,
}: {
  file: { id: string; urlPath: string; header: string; sizeBytes: number }
  opened: OpenedFile
}) {
  const archiveFile = useMemo(
    () => ({
      id: file.id,
      urlPath: file.urlPath,
      header: file.header,
      sizeBytes: file.sizeBytes,
      opened,
    }),
    [file.id, file.urlPath, file.header, file.sizeBytes, opened]
  )
  const handle = useEncryptedArchive(archiveFile)
  const source = useMemo<ArchiveSource | null>(
    () =>
      handle ? { kind: 'encrypted', archive: handle, owner: false } : null,
    [handle]
  )
  const name = safeFileName(opened.name)
  const mimeType = normalizedType(opened.type)
  return (
    <section
      aria-labelledby="archive-contents-title"
      className="w-[64rem] min-w-0 max-w-full space-y-3 px-6 pt-1"
      data-encrypted-archive
    >
      <h2
        id="archive-contents-title"
        className="flex items-center gap-2 text-sm font-medium"
      >
        <Archive className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        Archive contents
      </h2>
      {source && (
        <ArchiveBrowserContent
          key={file.id}
          file={{ id: file.id, name, mimeType }}
          format={detectArchiveFormat(name, mimeType)}
          source={source}
        />
      )}
    </section>
  )
}
