import { NextResponse } from 'next/server'

import { prisma } from '@/lib/database/prisma'
import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { generatorProfile } from '@/lib/uploads/profiles'

const api = routes('/api/profile/sharex', {
  failure: { message: 'Internal server error' },
  logger: loggers.users,
})

export const GET = api(async (request) => {
  const { session } = await requireSession('tokens.manage')

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { uploadToken: true, name: true },
  })

  if (!user) {
    throw new HttpError(404, 'User not found')
  }

  const profileId = await generatorProfile(
    session.user.id,
    new URL(request.url).searchParams.get('profileId')
  )

  const baseUrl =
    process.env.NODE_ENV === 'development'
      ? 'http://localhost:3000'
      : process.env.NEXTAUTH_URL?.replace(/\/$/, '') || ''

  if (!baseUrl) {
    throw new HttpError(500, 'Server configuration error')
  }

  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')

  try {
    new URL(normalizedBaseUrl)
  } catch {
    throw new HttpError(500, 'Invalid server URL configuration')
  }

  const config = {
    Version: '15.0.0',
    Name: 'Flare',
    DestinationType: 'ImageUploader, TextUploader, FileUploader',
    RequestMethod: 'POST',
    RequestURL: `${normalizedBaseUrl}/api/files${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`,
    Headers: {
      Authorization: `Bearer ${user.uploadToken}`,
    },
    Body: 'MultipartFormData',
    FileFormName: 'file',
    URL: '{json:data.url}',
    ThumbnailURL: '{json:data.url}',
    DeletionURL: '',
    ErrorMessage: '{json:error}',
  }

  const sanitizedName = (user.name || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')

  return new NextResponse(JSON.stringify(config, null, 2), {
    headers: {
      'Content-Disposition': `attachment; filename="${sanitizedName}-sharex.sxcu"`,
      'Content-Type': 'application/json',
    },
  })
})
