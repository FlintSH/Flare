'use client'

import { type ReactNode, useState } from 'react'

import Image from 'next/image'

import { thumbnailLoader } from '@/lib/files/urls'

/**
 * A shared folder tile's picture: a resized thumbnail rather than the
 * original, so a folder of photos opens quickly. `fallback` stands in for an
 * image the browser can't show.
 */
export function SharedTilePreview({
  src,
  fallback,
}: {
  src: string
  fallback: ReactNode
}) {
  const [failed, setFailed] = useState(false)
  if (failed) return fallback
  return (
    <Image
      loader={thumbnailLoader}
      src={src}
      alt=""
      fill
      // Wider than the tile, so a panorama cropped to the tile's shape
      // still has the pixels to fill its height.
      sizes="(min-width: 1024px) 40vw, (min-width: 768px) 50vw, (min-width: 480px) 75vw, 100vw"
      className="object-cover"
      onError={() => setFailed(true)}
    />
  )
}
