import { NextRequest, NextResponse } from 'next/server'

import { SETUP_PATHS } from './constants'

interface SetupCheckResponse {
  completed: boolean
}

export async function checkSetupStatus(
  request: NextRequest
): Promise<SetupCheckResponse> {
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http'
  const host = request.headers.get('host') || 'localhost:3000'

  const customHeaders = new Headers(request.headers)
  customHeaders.set('x-middleware-check', 'true')

  const response = await fetch(`${protocol}://${host}/api/setup/check`, {
    headers: customHeaders,
  })

  if (!response.ok) throw new Error('Failed to check setup status')
  return response.json()
}

export function handleSetupRedirect(
  request: NextRequest,
  setupCompleted: boolean
): NextResponse | null {
  // Handle setup routes
  if (SETUP_PATHS.some((path) => request.nextUrl.pathname.startsWith(path))) {
    if (setupCompleted) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
    return NextResponse.next()
  }

  // If setup is not complete, handle accordingly
  if (!setupCompleted) {
    if (request.nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Setup required' }, { status: 503 })
    }
    return NextResponse.redirect(new URL('/setup', request.url))
  }

  return null
}
