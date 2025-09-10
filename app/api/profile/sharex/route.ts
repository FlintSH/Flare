import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'

const logger = loggers.users

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
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

    const baseUrl =
      process.env.NODE_ENV === 'development'
        ? 'http://localhost:3000'
        : process.env.NEXTAUTH_URL?.replace(/\/$/, '') || ''

    if (!baseUrl) {
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      )
    }

    const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')

    try {
      new URL(normalizedBaseUrl)
    } catch {
      return NextResponse.json(
        { error: 'Invalid server URL configuration' },
        { status: 500 }
      )
    }

    const config = {
      Version: '15.0.0',
      Name: 'Flare',
      DestinationType: 'ImageUploader, TextUploader, FileUploader',
      RequestMethod: 'POST',
      RequestURL: `${normalizedBaseUrl}/api/files`,
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
  } catch (error) {
    logger.error('ShareX config generation error:', error as Error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
