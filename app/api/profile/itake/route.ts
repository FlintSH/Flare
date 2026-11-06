import { NextResponse } from 'next/server'

import { prisma } from '@/lib/database/prisma'
import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { UploadError } from '@/lib/uploads/options'

const api = routes('/api/profile/itake', {
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

  const selectedProfileId = new URL(request.url).searchParams.get('profileId')
  const profile = selectedProfileId
    ? await prisma.uploadProfile.findFirst({
        where: { id: selectedProfileId, userId: session.user.id },
      })
    : null
  if (selectedProfileId && !profile) {
    throw new UploadError('Upload profile not found.', 404)
  }

  const baseUrl =
    process.env.NEXTAUTH_URL ||
    (process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : '')

  if (!baseUrl) {
    throw new HttpError(500, 'Server configuration error')
  }

  let uploadUrl: URL
  try {
    uploadUrl = new URL(baseUrl)
    if (
      !['http:', 'https:'].includes(uploadUrl.protocol) ||
      uploadUrl.username ||
      uploadUrl.password ||
      uploadUrl.search ||
      uploadUrl.hash
    ) {
      throw new Error('Invalid server URL')
    }
    uploadUrl.pathname = `${uploadUrl.pathname.replace(/\/+$/, '')}/api/files`
    if (profile) uploadUrl.searchParams.set('profileId', profile.id)
  } catch {
    throw new HttpError(500, 'Invalid server URL configuration')
  }

  // iTake's .itup format uses a JSON dot-path for the returned share URL.
  const config = {
    name: `Flare — ${profile?.name ?? 'Account defaults'}`,
    request: {
      url: uploadUrl.toString(),
      method: 'POST',
      headers: { Authorization: `Bearer ${user.uploadToken}` },
    },
    body: { type: 'multipart', fileField: 'file', fields: {} },
    response: { linkPath: 'data.url' },
  }

  const sanitizedName = (user.name || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')

  return new NextResponse(JSON.stringify(config, null, 2), {
    headers: {
      'Content-Disposition': `attachment; filename="${sanitizedName}-itake.itup"`,
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
    },
  })
})
