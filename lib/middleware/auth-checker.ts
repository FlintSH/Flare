import { NextRequest, NextResponse } from 'next/server'

import { getToken } from 'next-auth/jwt'

import { FILE_URL_PATTERN } from './constants'

export async function checkAuthentication(
  request: NextRequest
): Promise<NextResponse | null> {
  // Skip auth check for file pattern URLs
  if (FILE_URL_PATTERN.test(request.nextUrl.pathname)) {
    return null
  }

  const token = await getToken({ req: request })
  if (!token) {
    return NextResponse.redirect(new URL(`/auth/login`, request.url))
  }

  return null
}
