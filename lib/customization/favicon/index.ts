// The favicon's rules and address, shared by the settings control and the
// server, so this module must stay browser-safe.
import { type ImagePolicy, imageProblem } from '../image'

export const FAVICON_TYPE = 'image/png'
export const FAVICON_MAX_BYTES = 1024 * 1024

export const FAVICON_POLICY: ImagePolicy = {
  types: [FAVICON_TYPE],
  maxBytes: FAVICON_MAX_BYTES,
  tooLarge: 'Please upload a file smaller than 1 MB.',
  wrongType: 'Please upload a PNG image file.',
}

/** Why a chosen file can't become the favicon, or null when it can. */
export function faviconProblem(file: { size: number; type: string }) {
  return imageProblem(FAVICON_POLICY, file)
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
