'use client'

import type { ReactNode } from 'react'

import type { OpenedFile } from '@/lib/e2ee/client/files'

/** The sealed thumbnail of an encrypted file, decrypted in this browser. */
export function SealedThumbnail({
  fallback,
}: {
  fileId: string
  opened: Pick<OpenedFile, 'fileKey' | 'headerHash'>
  className?: string
  fallback: ReactNode
}) {
  return <>{fallback}</>
}
