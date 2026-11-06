/**
 * NEXTAUTH_URL, the address people use to reach Flare, as an http(s) URL
 * without credentials; null when it is unset or isn't one. Its origin is the
 * one browsers send from behind a reverse proxy, the passkey origin and the
 * session cookies' scheme; generated links also keep its path.
 */
export function publicOrigin(
  env: Record<string, string | undefined> = process.env
): URL | null {
  if (!env.NEXTAUTH_URL) return null
  let url: URL
  try {
    url = new URL(env.NEXTAUTH_URL)
  } catch {
    return null
  }
  return ['http:', 'https:'].includes(url.protocol) &&
    !url.username &&
    !url.password
    ? url
    : null
}
