import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { checkAuthentication } from './lib/middleware/auth-checker'
import { handleBotRequest } from './lib/middleware/bot-handler'
import { PUBLIC_PATHS } from './lib/middleware/constants'

export async function middleware(request: NextRequest) {
  // Early return for raw and direct endpoints
  if (
    request.nextUrl.pathname.endsWith('/raw') ||
    request.nextUrl.pathname.endsWith('/direct')
  ) {
    return NextResponse.next()
  }

  // Early return for shortened URLs
  if (request.nextUrl.pathname.startsWith('/u/')) {
    return NextResponse.next()
  }

  // Check if path is public
  if (
    PUBLIC_PATHS.some((path: string) =>
      request.nextUrl.pathname.startsWith(path)
    )
  ) {
    return NextResponse.next()
  }

  // Handle bot requests
  const botResponse = handleBotRequest(request)
  if (botResponse) return botResponse

  // Skip setup check for setup-related paths to avoid infinite redirects
  if (
    request.nextUrl.pathname.startsWith('/setup') ||
    request.nextUrl.pathname.startsWith('/api/setup')
  ) {
    // Still check auth for non-API setup paths
    if (!request.nextUrl.pathname.startsWith('/api/')) {
      const authResponse = await checkAuthentication(request)
      if (authResponse) return authResponse
    }
    return NextResponse.next()
  }

  // Check authentication for non-public paths
  // Setup check will be handled at the page level where Prisma can run
  const authResponse = await checkAuthentication(request)
  if (authResponse) return authResponse

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
