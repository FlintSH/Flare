import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { getToken } from 'next-auth/jwt'

import {
  RECOVERY_PATHS,
  recoveryRequestHeaders,
} from './lib/customization/recovery-request'
import { identifyCrawler } from './lib/embeds/crawlers'
import { checkAuthentication } from './lib/middleware/auth-checker'
import {
  PUBLIC_PATHS,
  isFileUrlPath,
  isSharePagePath,
} from './lib/middleware/constants'
import { isSetupPath } from './lib/setup/navigation'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const requestedRecovery =
    request.nextUrl.searchParams.get('recovery') === '1' &&
    RECOVERY_PATHS.includes(pathname)
  const recoveryToken = requestedRecovery
    ? await getToken({ req: request })
    : null
  const forwardedHeaders = recoveryRequestHeaders(
    request.headers,
    pathname,
    requestedRecovery,
    Boolean(recoveryToken)
  )
  const next = () =>
    NextResponse.next({ request: { headers: forwardedHeaders } })

  if (pathname.startsWith('/u/')) {
    return next()
  }

  if (PUBLIC_PATHS.some((path: string) => pathname.startsWith(path))) {
    return next()
  }

  if (isFileUrlPath(pathname)) {
    // A link-preview fetcher asking for a share page gets the file's preview
    // instead: the app page is built for people. The file's routes decide
    // access themselves, like the page.
    if (
      isSharePagePath(pathname) &&
      identifyCrawler(request.headers.get('user-agent'))
    ) {
      const url = request.nextUrl.clone()
      url.pathname = `${pathname}/embed`
      return NextResponse.rewrite(url, {
        request: { headers: forwardedHeaders },
      })
    }
    return next()
  }

  if (isSetupPath(pathname)) {
    return next()
  }

  const authResponse = await checkAuthentication(request)
  if (authResponse) return authResponse

  return next()
}

export const config = {
  // Never run for /api: those handlers own their session and bearer checks and
  // return JSON 401/403; a login redirect here would replace them and reject
  // valid scoped tokens. When the proxy runs, Next.js also clones the request
  // body and cuts it off at 10 MB, which broke larger uploads and chunk parts.
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico).*)'],
}
