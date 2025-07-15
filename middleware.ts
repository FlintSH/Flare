import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { checkAuthentication } from './lib/middleware/auth-checker'
import { handleBotRequest } from './lib/middleware/bot-handler'
import { PUBLIC_PATHS } from './lib/middleware/constants'

export async function middleware(request: NextRequest) {
  if (
    request.nextUrl.pathname.endsWith('/raw') ||
    request.nextUrl.pathname.endsWith('/direct')
  ) {
    return NextResponse.next()
  }

  if (request.nextUrl.pathname.startsWith('/u/')) {
    return NextResponse.next()
  }

  if (
    PUBLIC_PATHS.some((path: string) =>
      request.nextUrl.pathname.startsWith(path)
    )
  ) {
    return NextResponse.next()
  }

  const botResponse = handleBotRequest(request)
  if (botResponse) return botResponse

  if (
    request.nextUrl.pathname.startsWith('/setup') ||
    request.nextUrl.pathname.startsWith('/api/setup')
  ) {
    return NextResponse.next()
  }

  const authResponse = await checkAuthentication(request)
  if (authResponse) return authResponse

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
