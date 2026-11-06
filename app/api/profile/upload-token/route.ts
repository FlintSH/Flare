import { NextResponse } from 'next/server'

import { prisma } from '@/lib/database/prisma'
import { requireAccount } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { generalLimiter, rateLimit } from '@/lib/security/rate-limit'
import { newUploadToken } from '@/lib/users/credentials'

const api = routes('/api/profile/upload-token', {
  // The answer is a credential, like the generated uploader configurations.
  headers: { 'Cache-Control': 'private, no-store' },
  failure: { message: 'Internal server error' },
  logger: loggers.users,
})

export const GET = api(async (request) => {
  const user = await requireAccount(request)

  const userData = await prisma.user.findUnique({
    where: { id: user.id },
    select: { uploadToken: true },
  })

  if (!userData) {
    throw new HttpError(404, 'User not found')
  }

  return NextResponse.json({ uploadToken: userData.uploadToken })
})

export const POST = api(async (request) => {
  const limited = await rateLimit(request, generalLimiter)
  if (limited) return limited

  const user = await requireAccount(request)

  const userData = await prisma.user.update({
    where: { id: user.id },
    data: { uploadToken: newUploadToken() },
    select: { uploadToken: true },
  })

  return NextResponse.json({ uploadToken: userData.uploadToken })
})
