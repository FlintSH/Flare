import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { getToken } from 'next-auth/jwt'

import {
  RECOVERY_PATHS,
  recoveryRequestHeaders,
} from './lib/customization/recovery-request'
import { checkAuthentication } from './lib/middleware/auth-checker'
import { handleBotRequest } from './lib/middleware/bot-handler'
import { PUBLIC_PATHS, isFileUrlPath } from './lib/middleware/constants'
import {
  CSP_HEADER,
  NONCE_HEADER,
  contentSecurityPolicy,
  newNonce,
} from './lib/security/csp'
import { isSetupPath } from './lib/setup/navigation'

export async function proxy(request: NextRequest) {
  const requestedRecovery =
    request.nextUrl.searchParams.get('recovery') === '1' &&
    RECOVERY_PATHS.includes(request.nextUrl.pathname)
  const recoveryToken = requestedRecovery
    ? await getToken({ req: request })
    : null
  const forwardedHeaders = recoveryRequestHeaders(
    request.headers,
    request.nextUrl.pathname,
    requestedRecovery,
    Boolean(recoveryToken)
  )
  // File bytes and the video lookup are not pages: their routes send their
  // own headers, a sandbox policy among them.
  if (
    (request.nextUrl.pathname.endsWith('/raw') ||
      request.nextUrl.pathname.endsWith('/direct')) &&
    isFileUrlPath(request.nextUrl.pathname)
  ) {
    return NextResponse.next({ request: { headers: forwardedHeaders } })
  }

  // Every page gets a script policy with a nonce of its own
  // (docs/e2ee-spec.md, section 13). Next.js reads the nonce from the
  // request's policy header and puts it on the scripts it renders; the
  // layout reads `x-nonce` for the scripts Flare adds itself.
  const nonce = newNonce()
  const policy = contentSecurityPolicy(nonce, {
    development: process.env.NODE_ENV === 'development',
  })
  forwardedHeaders.set(NONCE_HEADER, nonce)
  forwardedHeaders.set(CSP_HEADER, policy)
  const next = () => {
    const response = NextResponse.next({
      request: { headers: forwardedHeaders },
    })
    response.headers.set(CSP_HEADER, policy)
    return response
  }

  if (request.nextUrl.pathname.startsWith('/u/')) {
    return next()
  }

  if (
    PUBLIC_PATHS.some((path: string) =>
      request.nextUrl.pathname.startsWith(path)
    )
  ) {
    return next()
  }

  const botResponse = handleBotRequest(request)
  if (botResponse) {
    return botResponse.headers.get('x-middleware-next') === '1'
      ? next()
      : botResponse
  }

  if (isSetupPath(request.nextUrl.pathname)) {
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
