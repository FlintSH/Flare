import type { NextRequest } from 'next/server'

import { CONSENT_PATH, REQUEST_COOKIE } from '@/lib/oauth/constants'

/**
 * Whether a request is a person's browser opening a page while a sign-in for
 * an agent waits in its cookie: the moment to send it on to finish that
 * sign-in. Only a page the person navigates to counts. Resuming uses the
 * cookie up, so a prefetch, a prerender or a data request that resumed would
 * spend it where nobody would see the consent screen.
 *
 * Next.js removes its own `RSC` and prefetch headers before the proxy runs,
 * so those are told apart by what the browser itself says: a data request is
 * not a navigation to a document. A client that says nothing about that must
 * at least be asking for HTML.
 */
export function resumesAgentSignIn(request: NextRequest): boolean {
  if (request.method !== 'GET' || !request.cookies.get(REQUEST_COOKIE)?.value)
    return false
  const { pathname } = request.nextUrl
  // The login and confirmation pages are where the person is still working,
  // and the consent screen is where a resumed sign-in ends up.
  if (pathname.startsWith('/auth/') || pathname.startsWith('/api/'))
    return false
  const header = (name: string) =>
    request.headers.get(name)?.toLowerCase() ?? null
  if (
    header('rsc') !== null ||
    header('next-router-prefetch') !== null ||
    header('next-router-state-tree') !== null ||
    [header('purpose'), header('sec-purpose'), header('x-moz')].some(
      (value) => value?.includes('prefetch') || value?.includes('prerender')
    )
  )
    return false
  const destination = header('sec-fetch-dest')
  if (destination === null)
    return header('accept')?.includes('text/html') ?? false
  const mode = header('sec-fetch-mode')
  return destination === 'document' && (mode === null || mode === 'navigate')
}

/**
 * The consent screen is never shown inside another page, Flare's own
 * included: a frame could cover it and borrow the click that approves.
 */
export function refusesFraming(pathname: string): boolean {
  return pathname === CONSENT_PATH
}

export const FRAMING_HEADERS = {
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
} as const
