import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's upload token and name
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

    // Normalize the base URL to remove trailing slashes
    const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')

    try {
      // Validate the URL is properly formatted
      new URL(normalizedBaseUrl)
    } catch {
      return NextResponse.json(
        { error: 'Invalid server URL configuration' },
        { status: 500 }
      )
    }

    // Generate ShareX configuration
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
      URL: '{json:url}',
      ThumbnailURL: '{json:url}',
      DeletionURL: '',
      ErrorMessage: '{json:error}',
    }

    // Use sanitized username for the filename
    const sanitizedName = (user.name || 'user')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')

    // Return the configuration file
    return new NextResponse(JSON.stringify(config, null, 2), {
      headers: {
        'Content-Disposition': `attachment; filename="${sanitizedName}-sharex.sxcu"`,
        'Content-Type': 'application/json',
      },
    })
  } catch (error) {
    console.error('ShareX config generation error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
