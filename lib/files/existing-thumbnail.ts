import { loggers } from '@/lib/logger'

/**
 * The thumbnail that the server makes while it encrypts an existing image
 * (docs/e2ee-spec.md, section 14.2). It has the form of section 12.1: WebP,
 * longest side 480 pixels, at most 250 000 bytes. The server has the
 * plaintext during this job only, so this is the one moment it can spare the
 * browser of the owner a download of every image.
 */

/** The same limits as the browser (`lib/files/thumbnail-client.ts`). */
export const SERVER_THUMBNAIL_LONGEST_SIDE = 480
export const SERVER_THUMBNAIL_MAX_BYTES = 250_000
/** A larger image waits for the browser of the owner. */
export const SERVER_THUMBNAIL_SOURCE_MAX_BYTES = 25 * 1024 * 1024
const MAX_PIXELS = 100_000_000
const QUALITIES = [80, 60, 40]

/**
 * Raster types only. SVG is a document that can refer to other resources,
 * and the server does not render it.
 */
const TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
])

export function serverCanThumbnail(type: string, bytes: number) {
  return (
    TYPES.has(type.toLowerCase()) &&
    bytes > 0 &&
    bytes <= SERVER_THUMBNAIL_SOURCE_MAX_BYTES
  )
}

type Sharp = (typeof import('sharp'))['default']
let sharpModule: Promise<Sharp | null> | undefined

/** sharp is an optional dependency: without it every thumbnail waits for the browser. */
function loadSharp() {
  sharpModule ??= import('sharp')
    .then((module): Sharp | null => module.default)
    .catch(() => {
      loggers.files.warn(
        'sharp is not installed: thumbnails of existing images wait for the browser of their owner'
      )
      return null
    })
  return sharpModule
}

/** A WebP thumbnail of `image`, or null when the server cannot make one. */
export async function serverThumbnail(
  image: Uint8Array
): Promise<Uint8Array | null> {
  const sharp = await loadSharp()
  if (!sharp) return null
  try {
    for (const quality of QUALITIES) {
      const thumbnail = await sharp(image, {
        limitInputPixels: MAX_PIXELS,
        // The first frame of an animation, as the browser draws it.
        animated: false,
        failOn: 'error',
      })
        // Applies the EXIF orientation and drops the metadata.
        .rotate()
        .resize({
          width: SERVER_THUMBNAIL_LONGEST_SIDE,
          height: SERVER_THUMBNAIL_LONGEST_SIDE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality })
        .toBuffer()
      if (thumbnail.length <= SERVER_THUMBNAIL_MAX_BYTES)
        return new Uint8Array(thumbnail)
    }
  } catch {
    // An image that sharp cannot read: the browser of the owner tries later.
  }
  return null
}
