import { THUMBNAIL_MAX_BYTES } from '@/lib/e2ee/client/files'

import { normalizedType } from './safe-render'

/**
 * The thumbnail of a file, made in the browser from its plaintext
 * (docs/e2ee-spec.md, section 12.1): a WebP image whose longest side is 480
 * pixels, for an image and for the first frame of a video that this browser
 * can decode. The caller seals it. The server never gets it in the clear.
 * Client only.
 */

export const THUMBNAIL_LONGEST_SIDE = 480
/** A video that gives no frame in this time gets no thumbnail. */
const VIDEO_TIMEOUT_MS = 15_000
const QUALITIES = [0.8, 0.6, 0.4]

/** Whether a thumbnail can exist for a type: an image or a video. */
export function thumbnailKind(type: string): 'image' | 'video' | null {
  const normalized = normalizedType(type)
  // An SVG is a document. Drawing one that a stranger wrote is left out.
  if (normalized.startsWith('image/') && normalized !== 'image/svg+xml')
    return 'image'
  return normalized.startsWith('video/') ? 'video' : null
}

function fitted(width: number, height: number) {
  const scale = Math.min(1, THUMBNAIL_LONGEST_SIDE / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

async function encode(
  source: CanvasImageSource,
  width: number,
  height: number
): Promise<Uint8Array | null> {
  if (!width || !height) return null
  const size = fitted(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(source, 0, 0, size.width, size.height)
  for (const quality of QUALITIES) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', quality)
    )
    // A browser that cannot write WebP answers with a PNG.
    if (!blob || blob.type !== 'image/webp') return null
    if (blob.size <= THUMBNAIL_MAX_BYTES)
      return new Uint8Array(await blob.arrayBuffer())
  }
  return null
}

async function imageThumbnail(file: Blob): Promise<Uint8Array | null> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    // Not an image that this browser decodes.
    return null
  }
  try {
    return await encode(bitmap, bitmap.width, bitmap.height)
  } finally {
    bitmap.close()
  }
}

function videoThumbnail(file: Blob): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    let settled = false
    const finish = (thumbnail: Uint8Array | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
      resolve(thumbnail)
    }
    const timer = window.setTimeout(() => finish(null), VIDEO_TIMEOUT_MS)
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.addEventListener('error', () => finish(null))
    video.addEventListener(
      'loadeddata',
      () => {
        // The first frame of many recordings is black. A frame a little
        // later is the first one worth showing.
        const target = Math.min(0.5, (video.duration || 0) / 2)
        if (target > 0 && Number.isFinite(target)) video.currentTime = target
        else void capture()
      },
      { once: true }
    )
    video.addEventListener('seeked', () => void capture(), { once: true })
    const capture = () =>
      encode(video, video.videoWidth, video.videoHeight).then(finish, () =>
        finish(null)
      )
    video.src = url
  })
}

/**
 * A WebP thumbnail of `file`, or null when none can be made: the type is
 * not an image or a video, or this browser cannot decode it.
 */
export async function makeThumbnail(
  file: Blob,
  type: string
): Promise<Uint8Array | null> {
  const kind = thumbnailKind(type)
  if (kind === 'image') return imageThumbnail(file)
  if (kind === 'video') return videoThumbnail(file)
  return null
}
