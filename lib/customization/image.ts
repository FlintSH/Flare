// What an uploaded image may be: the favicon, the studio's logos, avatars.
// Controls check a chosen file with these rules before sending it, so this
// module must stay browser-safe.

/** The image formats Flare tells apart by their first bytes. */
export type ImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

export const IMAGE_NAMES: Record<ImageType, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/gif': 'GIF',
  'image/webp': 'WebP',
}

function startsWith(bytes: Uint8Array, signature: string, offset = 0) {
  return [...signature].every(
    (char, index) => bytes[offset + index] === char.charCodeAt(0)
  )
}

/** The format these bytes are an image of, by its signature, or null. */
export function imageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, '\x89PNG\r\n\x1a\n')) return 'image/png'
  if (startsWith(bytes, '\xff\xd8\xff')) return 'image/jpeg'
  if (startsWith(bytes, 'GIF')) return 'image/gif'
  if (startsWith(bytes, 'RIFF') && startsWith(bytes, 'WEBP', 8))
    return 'image/webp'
  return null
}

/** What one kind of image upload accepts, and how it words a refusal. */
export interface ImagePolicy {
  types: readonly ImageType[]
  maxBytes: number
  /** Why a larger file is refused. */
  tooLarge: string
  /** Why a file of another type is refused. */
  wrongType: string
}

export interface ImageProblem {
  status: 413 | 415
  title: string
  message: string
}

/**
 * Why a chosen file can't be used, judging by its size and the type the
 * browser reports for it, or null when it can.
 */
export function imageProblem(
  policy: ImagePolicy,
  file: { size: number; type: string }
): ImageProblem | null {
  if (file.size > policy.maxBytes)
    return { status: 413, title: 'File too large', message: policy.tooLarge }
  if (!(policy.types as readonly string[]).includes(file.type))
    return {
      status: 415,
      title: 'Invalid file type',
      message: policy.wrongType,
    }
  return null
}
