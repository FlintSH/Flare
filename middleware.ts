import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { checkAuthentication } from './lib/middleware/auth-checker'
import { handleBotRequest } from './lib/middleware/bot-handler'
import { PUBLIC_PATHS } from './lib/middleware/constants'
import {
  checkSetupStatus,
  handleSetupRedirect,
} from './lib/middleware/setup-checker'

export async function middleware(request: NextRequest) {
  // Early return for raw endpoints
  if (request.nextUrl.pathname.endsWith('/raw')) {
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

  // Check setup status and handle setup routes
  try {
    const { completed } = await checkSetupStatus(request)

    const setupResponse = handleSetupRedirect(request, completed)
    if (setupResponse) return setupResponse

    // Check authentication for non-public paths
    const authResponse = await checkAuthentication(request)
    if (authResponse) return authResponse

    return NextResponse.next()
  } catch (error) {
    console.error('Setup check failed:', error)
    // On error, allow request to continue to avoid blocking access
    // but log the error for monitoring
    return NextResponse.next()
  }
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
