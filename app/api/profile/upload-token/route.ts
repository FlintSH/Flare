import { NextResponse } from 'next/server'

import { randomUUID } from 'crypto'

import { requireAuth } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { generalLimiter, rateLimit } from '@/lib/security/rate-limit'

const logger = loggers.users

export async function GET(req: Request) {
  try {
    const { user, response } = await requireAuth(req)
    if (response) return response

    const userData = await prisma.user.findUnique({
      where: { id: user.id },
      select: { uploadToken: true },
    })

    if (!userData) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({ uploadToken: userData.uploadToken })
  } catch (error) {
    logger.error('Error fetching upload token:', error as Error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  const limited = await rateLimit(req, generalLimiter)
  if (limited) return limited

  try {
    const { user, response } = await requireAuth(req)
    if (response) return response

    const userData = await prisma.user.update({
      where: { id: user.id },
      data: { uploadToken: randomUUID() },
      select: { uploadToken: true },
    })

    return NextResponse.json({ uploadToken: userData.uploadToken })
  } catch (error) {
    logger.error('Error refreshing upload token:', error as Error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
