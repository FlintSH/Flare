import { PUBLIC_ID_PATTERN, isReservedPublicId } from '@/lib/users/public-id'

// `/{urlId}/{name}`, optionally followed by `/raw` or `/direct`, where the
// first segment can be a URL ID or vanity ID. The first pattern is the
// original rule for names with an extension.
const NAME_WITH_EXTENSION = new RegExp(
  `^/${PUBLIC_ID_PATTERN}/[^/]+\\.[^/]+(?:/raw|/direct)?$`
)
const ANY_NAME = new RegExp(`^/(${PUBLIC_ID_PATTERN})/[^/]+(?:/raw|/direct)?$`)

/**
 * Whether a path is a file's share page, `/raw` content, or `/direct` video
 * URL. Signed-out visitors may request these; the routes then apply the
 * file's visibility and password. A name with an extension always qualifies,
 * as before. A name without one, such as `readme`, qualifies unless the first
 * segment is one of Flare's own routes, so `/dashboard/files` still needs a
 * session.
 */
export function isFileUrlPath(pathname: string): boolean {
  if (NAME_WITH_EXTENSION.test(pathname)) return true
  const id = ANY_NAME.exec(pathname)?.[1]
  return id !== undefined && !isReservedPublicId(id)
}

export const PUBLIC_PATHS = [
  '/_next',
  '/icon.svg',
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/verify-email',
  '/s/folders/',
]

export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'avi', 'mkv']
