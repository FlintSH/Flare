import { NextRequest, NextResponse } from 'next/server'

import { getToken } from 'next-auth/jwt'

import { loggers } from '@/lib/logger'

import { FILE_URL_PATTERN } from './constants'

const logger = loggers.middleware

export async function checkAuthentication(
  request: NextRequest
): Promise<NextResponse | null> {
  if (FILE_URL_PATTERN.test(request.nextUrl.pathname)) {
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

    return null
  } catch (error) {
    logger.error('Authentication check failed', error as Error, {
      path: request.nextUrl.pathname,
      method: request.method,
    })
    return NextResponse.redirect(new URL(`/auth/login`, request.url))
  }
}
