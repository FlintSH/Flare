// What a studio logo may be, shared by the appearance studio, the upload
// route and saved appearance documents, so this module must stay browser-safe.
import { type ImagePolicy, imageProblem, imageType } from './image'

export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export const LOGO_MAX_BYTES = 256 * 1024
/** The logo inputs' `accept` attribute. */
export const LOGO_ACCEPT = LOGO_TYPES.join(',')

export const LOGO_POLICY: ImagePolicy = {
  types: LOGO_TYPES,
  maxBytes: LOGO_MAX_BYTES,
  tooLarge: 'Please upload a logo of at most 256 KB.',
  wrongType: 'Please upload a PNG, JPEG, or WebP image.',
}

/** Why a chosen file can't be a logo, or null when it can. */
export function logoProblem(file: { size: number; type: string }) {
  return imageProblem(LOGO_POLICY, file)
}

/**
 * Saved logos longer than this are refused before decoding: they hold more
 * than LOGO_MAX_BYTES.
 */
export const LOGO_DATA_URL_MAX_LENGTH = 360_000

/**
 * Whether a saved logo is one the studio accepts: a base64 data URL of a logo
 * type, holding at most LOGO_MAX_BYTES of an image of that type.
 */
export function isLogoDataUrl(value: string): boolean {
  const match = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    value
  )
  if (!match || !(LOGO_TYPES as readonly string[]).includes(match[1]))
    return false
  let bytes: string
  try {
    bytes = atob(match[2])
  } catch {
    return false
  }
  const head = Uint8Array.from(bytes.slice(0, 12), (char) => char.charCodeAt(0))
  return bytes.length <= LOGO_MAX_BYTES && imageType(head) === match[1]
}
