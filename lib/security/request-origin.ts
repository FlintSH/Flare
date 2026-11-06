import { publicOrigin } from './public-origin'

/**
 * Whether a browser sent this request from Flare's own pages: its own origin,
 * or the public origin when a reverse proxy hands Next internal HTTP. Never
 * proxy headers. Clients that send no Origin, such as scripts, pass.
 */
export function isSameOriginRequest(request: Request): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false
  const origin = request.headers.get('origin')
  return (
    !origin ||
    origin === new URL(request.url).origin ||
    origin === publicOrigin()?.origin
  )
}
