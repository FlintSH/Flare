import { PUBLIC_ID_PATTERN, isReservedPublicId } from '@/lib/users/public-id'

/** The routes under a share link: `/{urlId}/{name}/{route}`. */
const FILE_ROUTES = ['raw', 'direct', 'media', 'embed'] as const
const ROUTE = `(?:/(?:${FILE_ROUTES.join('|')}))?`

// `/{urlId}/{name}`, optionally followed by one of its routes, where the
// first segment can be a URL ID or vanity ID.
const NAME_WITH_EXTENSION = new RegExp(
  `^/${PUBLIC_ID_PATTERN}/[^/]+\\.[^/]+${ROUTE}$`
)
const ANY_NAME = new RegExp(`^/(${PUBLIC_ID_PATTERN})/[^/]+${ROUTE}$`)

/**
 * Whether a path is a file's share page or one of the routes under it, such
 * as its `/raw` content. Signed-out visitors may request these; the routes
 * then apply the file's visibility and password. A name with an extension
 * always qualifies. A name without one, such as `readme`, qualifies unless
 * the first segment is one of Flare's own routes, so `/dashboard/files` still
 * needs a session.
 */
export function isFileUrlPath(pathname: string): boolean {
  if (NAME_WITH_EXTENSION.test(pathname)) return true
  const id = ANY_NAME.exec(pathname)?.[1]
  return id !== undefined && !isReservedPublicId(id)
}

/**
 * Whether a file path names a share page itself, not a route under it. A
 * file can be called `raw` or `embed`, so the segments are counted.
 */
export function isSharePagePath(pathname: string): boolean {
  return isFileUrlPath(pathname) && pathname.split('/').length === 3
}

export const PUBLIC_PATHS = [
  '/_next',
  '/icon.svg',
  '/video-poster.png',
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/verify-email',
  '/s/folders/',
]
