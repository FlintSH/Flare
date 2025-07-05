import { NextRequest, NextResponse } from 'next/server'

import { getToken } from 'next-auth/jwt'

import { prisma } from '@/lib/database/prisma'

import { FILE_URL_PATTERN } from './constants'

export async function checkSetupCompletion(): Promise<boolean> {
  try {
    const userCount = await prisma.user.count()
    return userCount > 0
  } catch (error) {
    console.error('Setup check error in middleware:', error)
    return false
  }
}

export async function checkAuthentication(
  request: NextRequest
): Promise<NextResponse | null> {
  if (FILE_URL_PATTERN.test(request.nextUrl.pathname)) {
    return null
  }

  try {
    const token = await getToken({ req: request })

    if (!token) {
      return NextResponse.redirect(new URL(`/auth/login`, request.url))
    }

    return null
  } catch (error) {
    console.error('Authentication check failed:', error)
    return NextResponse.redirect(new URL(`/auth/login`, request.url))
  }
}
