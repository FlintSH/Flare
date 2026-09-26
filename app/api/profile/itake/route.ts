import { NextResponse } from 'next/server'

import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { requirePermission } from '@/lib/permissions/server'
import { UploadError, uploadErrorResponse } from '@/lib/uploads/options'

const logger = loggers.users

export async function GET(req: Request) {
  try {
    const { session, response: permissionDenied } =
      await requirePermission('tokens.manage')
    if (permissionDenied) return permissionDenied
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { uploadToken: true, name: true },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const selectedProfileId = new URL(req.url).searchParams.get('profileId')
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
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      )
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
      return NextResponse.json(
        { error: 'Invalid server URL configuration' },
        { status: 500 }
      )
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
  } catch (error) {
    if (error instanceof UploadError) return uploadErrorResponse(error)
    logger.error('iTake config generation error:', error as Error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
