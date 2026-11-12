import { publicOrigin } from '@/lib/security/public-origin'

/**
 * The address a request reached Flare at, without a trailing slash, for the
 * absolute URLs a preview needs. The configured public address wins when the
 * request names its host, so its scheme is right behind any proxy. Another
 * host, such as a second domain, is taken to use HTTPS in production: Flare
 * can't see which scheme a proxy accepted.
 */
export function requestOrigin(headers: Headers): string {
  const configured = publicOrigin()
  const host = headers.get('host')
  // A forwarded host is only ever recognized, never repeated: any client can
  // send one, and a preview must not name a host of the client's choosing.
  const forwarded = headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  if (
    configured &&
    (!host || host === configured.host || forwarded === configured.host)
  )
    return configured.href.replace(/\/+$/, '')
  const scheme = process.env.NODE_ENV === 'production' ? 'https' : 'http'
  try {
    return new URL(`${scheme}://${host ?? 'localhost:3000'}`).origin
  } catch {
    return 'http://localhost:3000'
  }
}
