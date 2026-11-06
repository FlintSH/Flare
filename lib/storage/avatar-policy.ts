// What an avatar may be, shared by the profile control and the upload route,
// so this module must stay browser-safe.

/** Formats every browser shows; avatars are served as JPEG whatever they are. */
export const AVATAR_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024
/** The avatar input's `accept` attribute. */
export const AVATAR_ACCEPT = AVATAR_TYPES.join(',')

export interface AvatarProblem {
  status: 413 | 415
  title: string
  message: string
}

/** Why a chosen file can't become an avatar, or null when it can. */
export function avatarProblem(file: {
  size: number
  type: string
}): AvatarProblem | null {
  if (file.size > AVATAR_MAX_BYTES)
    return {
      status: 413,
      title: 'File too large',
      message: 'Please upload an image of at most 2 MB.',
    }
  if (!(AVATAR_TYPES as readonly string[]).includes(file.type))
    return {
      status: 415,
      title: 'Invalid file type',
      message: 'Please upload a PNG, JPEG, GIF, or WebP image.',
    }
  return null
}
