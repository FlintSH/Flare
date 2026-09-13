import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { getToken } from 'next-auth/jwt'

import {
  RECOVERY_PATHS,
  recoveryRequestHeaders,
} from './lib/customization/recovery-request'
import { checkAuthentication } from './lib/middleware/auth-checker'
import { handleBotRequest } from './lib/middleware/bot-handler'
import { FILE_URL_PATTERN, PUBLIC_PATHS } from './lib/middleware/constants'

export async function middleware(request: NextRequest) {
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
    recoveryToken?.role === 'ADMIN'
  )
  const next = () =>
    NextResponse.next({ request: { headers: forwardedHeaders } })
  if (
    (request.nextUrl.pathname.endsWith('/raw') ||
      request.nextUrl.pathname.endsWith('/direct')) &&
    FILE_URL_PATTERN.test(request.nextUrl.pathname)
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

  if (
    request.nextUrl.pathname.startsWith('/setup') ||
    request.nextUrl.pathname.startsWith('/api/setup')
  ) {
    return next()
  }

  const authResponse = await checkAuthentication(request)
  if (authResponse) return authResponse

  return next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
