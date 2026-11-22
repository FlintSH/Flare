import { NextRequest, NextResponse } from 'next/server'

import { getToken } from 'next-auth/jwt'

import { loggers } from '@/lib/logger'
import { RESUME_PATH } from '@/lib/oauth/constants'

import { resumesAgentSignIn } from './agent-sign-in'
import { isFileUrlPath } from './constants'

const logger = loggers.middleware

export async function checkAuthentication(
  request: NextRequest
): Promise<NextResponse | null> {
  if (isFileUrlPath(request.nextUrl.pathname)) {
    return null
  }

  try {
    const token = await getToken({ req: request })

    if (!token) {
      logger.debug('No authentication token found, redirecting to login', {
        path: request.nextUrl.pathname,
        method: request.method,
      })
      return NextResponse.redirect(new URL(`/auth/login`, request.url))
    }

    // Signed in, with a sign-in for an agent waiting: continue it. The
    // endpoint clears the cookie, so this happens once.
    if (resumesAgentSignIn(request))
      return NextResponse.redirect(new URL(RESUME_PATH, request.url))

    return null
  } catch (error) {
    logger.error('Authentication check failed', error as Error, {
      path: request.nextUrl.pathname,
      method: request.method,
    })
    return NextResponse.redirect(new URL(`/auth/login`, request.url))
  }
}
