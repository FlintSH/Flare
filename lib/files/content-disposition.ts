import { sanitizeDisplayName } from '@/lib/security/paths'

/**
 * The `Content-Disposition` value for sending a file called `name`, whether
 * Flare streams it or storage serves it from a signed URL. Only the last path
 * segment is used, without control characters. Browsers read the UTF-8 name
 * from `filename*`; the quoted `filename` repeats it, percent-encoded, for
 * clients that don't.
 */
export function contentDisposition(
  name: string,
  type: 'inline' | 'attachment'
): string {
  const encoded = encodeURIComponent(sanitizeDisplayName(name))
  // RFC 5987 also escapes ' ( ) *, which a quoted string may contain as is.
  const extended = encoded.replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  )
  return `${type}; filename="${encoded}"; filename*=UTF-8''${extended}`
}
