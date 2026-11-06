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
  const next = () =>
    NextResponse.next({ request: { headers: forwardedHeaders } })
  if (
    (request.nextUrl.pathname.endsWith('/raw') ||
      request.nextUrl.pathname.endsWith('/direct')) &&
    isFileUrlPath(request.nextUrl.pathname)
  ) {
    return next()
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
