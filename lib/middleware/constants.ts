/**
 * First path segments that belong to Flare's own routes or are held back for
 * them. No vanity ID may use one, and they are never read as a URL ID.
 */
export const RESERVED_URL_IDS = [
  'api',
  'auth',
  'dashboard',
  'admin',
  'settings',
  'setup',
  'raw',
  'direct',
  'u',
  'profile',
  'avatars',
  '_next',
] as const

// `/{urlId}/{name}`, optionally followed by `/raw` or `/direct`. URL and vanity
// IDs are 3 to 33 characters, which rules out the one-letter `/s/` and `/u/`
// routes. The first pattern is the original rule for names with an extension.
const NAME_WITH_EXTENSION =
  /^\/[A-Za-z0-9][A-Za-z0-9-]{1,31}[A-Za-z0-9]\/[^\/]+\.[^\/]+(?:\/raw|\/direct)?$/
const ANY_NAME =
  /^\/([A-Za-z0-9][A-Za-z0-9-]{1,31}[A-Za-z0-9])\/[^\/]+(?:\/raw|\/direct)?$/

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
  const urlId = ANY_NAME.exec(pathname)?.[1].toLowerCase()
  return (
    urlId !== undefined &&
    !(RESERVED_URL_IDS as readonly string[]).includes(urlId)
  )
}

export const PUBLIC_PATHS = [
  '/api/auth',
  '/_next',
  '/favicon.ico',
  '/icon.svg',
  '/api/setup/check',
  '/api/health',
  '/api/files',
  '/api/urls',
  '/api/storage/type',
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/verify-email',
  '/s/folders/',
]

export const SETUP_PATHS = ['/setup', '/api/setup']

export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'avi', 'mkv']
