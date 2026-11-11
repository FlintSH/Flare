'use client'

import { type ReactNode, useEffect, useState } from 'react'

import type { OpenedFile } from '@/lib/e2ee/client/files'
import { sealedThumbnailUrl } from '@/lib/e2ee/client/thumbnails'

/**
 * The thumbnail of an encrypted file (docs/e2ee-spec.md, section 12.1). The
 * server stores it sealed. This browser opens it with the file key, in a
 * worker, and keeps the image in memory only. `fallback` shows while it
 * loads and for a file that has none.
 */
export function SealedThumbnail({
  fileId,
  opened,
  className,
  alt = '',
  fallback,
}: {
  fileId: string
  opened: Pick<OpenedFile, 'fileKey' | 'headerHash'>
  className?: string
  alt?: string
  fallback: ReactNode
}) {
  const [shown, setShown] = useState<{ id: string; url: string } | null>(null)
  useEffect(() => {
    let current = true
    void sealedThumbnailUrl(fileId, opened).then(
      (url) => {
        if (current) setShown(url ? { id: fileId, url } : null)
      },
      () => {
        if (current) setShown(null)
      }
    )
    return () => {
      current = false
    }
  }, [fileId, opened])
  if (!shown || shown.id !== fileId) return <>{fallback}</>
  return (
    // An object URL of bytes that this browser decrypted and checked.
    <img
      src={shown.url}
      alt={alt}
      data-sealed-thumbnail=""
      draggable={false}
      className={className}
      onError={() => setShown(null)}
    />
  )
}
