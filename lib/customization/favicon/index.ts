// The favicon's rules and address, shared by the settings control and the
// server, so this module must stay browser-safe.

export const FAVICON_TYPE = 'image/png'
export const FAVICON_MAX_BYTES = 1024 * 1024

export interface FaviconProblem {
  status: 413 | 415
  title: string
  message: string
}

/** Why a chosen file can't become the favicon, or null when it can. */
export function faviconProblem(file: {
  size: number
  type: string
}): FaviconProblem | null {
  if (file.size > FAVICON_MAX_BYTES)
    return {
      status: 413,
      title: 'File too large',
      message: 'Please upload a file smaller than 1 MB.',
    }
  if (file.type !== FAVICON_TYPE)
    return {
      status: 415,
      title: 'Invalid file type',
      message: 'Please upload a PNG image file.',
    }
  return null
}

const ROUTE = '/api/favicon'
const VERSION = /^[0-9a-f]{16}$/

/** The address of the favicon whose content has this version. */
export function faviconAddress(version: string) {
  return `${ROUTE}?v=${version}`
}

/**
 * The address pages link to for the saved favicon, or null when none is
 * saved. Uploads save the address with a hash of the icon, so a replaced icon
 * gets a new one. Anything else, such as a value saved by an earlier version,
 * links to a version that never matches and so is never cached for long.
 */
export function faviconUrl(saved: string | null | undefined): string | null {
  if (!saved) return null
  const version = saved.startsWith(`${ROUTE}?v=`)
    ? saved.slice(ROUTE.length + 3)
    : ''
  return VERSION.test(version) ? saved : faviconAddress('0')
}
