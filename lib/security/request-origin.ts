/** Check browser writes against explicit app origins, never proxy headers. */
export function isSameOriginRequest(request: Request): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false
  const origin = request.headers.get('origin')
  if (!origin) return true

  const allowed = new Set([new URL(request.url).origin])
  // A reverse proxy can expose HTTPS while Next receives internal HTTP. This
  // operator-controlled URL is also the public origin used for authentication.
  if (process.env.NEXTAUTH_URL) {
    try {
      const publicUrl = new URL(process.env.NEXTAUTH_URL)
      if (
        ['http:', 'https:'].includes(publicUrl.protocol) &&
        !publicUrl.username &&
        !publicUrl.password
      ) {
        allowed.add(publicUrl.origin)
      }
    } catch {
      // A malformed setting must not disable the request-origin boundary.
    }
  }
  return allowed.has(origin)
}
