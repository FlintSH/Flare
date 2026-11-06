// What an avatar may be, shared by the profile control and the upload route,
// so this module must stay browser-safe.
import { type ImagePolicy, imageProblem } from '@/lib/customization/image'

/** Formats every browser shows; avatars are served as JPEG whatever they are. */
export const AVATAR_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024
export const AVATAR_ACCEPT = AVATAR_TYPES.join(',')

export const AVATAR_POLICY: ImagePolicy = {
  types: AVATAR_TYPES,
  maxBytes: AVATAR_MAX_BYTES,
  tooLarge: 'Please upload an image of at most 2 MB.',
  wrongType: 'Please upload a PNG, JPEG, GIF, or WebP image.',
}

/** Why a chosen file can't become an avatar, or null when it can. */
export function avatarProblem(file: { size: number; type: string }) {
  return imageProblem(AVATAR_POLICY, file)
}
