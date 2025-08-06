import { NextRequest, NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { CompressionService } from '@/lib/compression'
import { prisma } from '@/lib/database/prisma'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const settings = await prisma.compressionSettings.findUnique({
      where: { userId: session.user.id },
    })

    if (!settings) {
      const defaultSettings = await CompressionService.getDefaultSettings(
        session.user.role === 'ADMIN'
      )
      return NextResponse.json(defaultSettings)
    }

    return NextResponse.json(settings)
  } catch (error) {
    console.error('Failed to fetch compression settings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch compression settings' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    const settings = await prisma.compressionSettings.upsert({
      where: { userId: session.user.id },
      update: {
        enabled: body.enabled,
        imageCompression: body.imageCompression,
        imageQuality: body.imageQuality,
        imageFormat: body.imageFormat,
        videoCompression: body.videoCompression,
        videoQuality: body.videoQuality,
        videoBitrate: body.videoBitrate,
        videoCodec: body.videoCodec,
        maxWidth: body.maxWidth,
        maxHeight: body.maxHeight,
        keepOriginal: body.keepOriginal,
        autoCompress: body.autoCompress,
        compressionThreshold: body.compressionThreshold,
      },
      create: {
        userId: session.user.id,
        enabled: body.enabled,
        imageCompression: body.imageCompression,
        imageQuality: body.imageQuality,
        imageFormat: body.imageFormat,
        videoCompression: body.videoCompression,
        videoQuality: body.videoQuality,
        videoBitrate: body.videoBitrate,
        videoCodec: body.videoCodec,
        maxWidth: body.maxWidth,
        maxHeight: body.maxHeight,
        keepOriginal: body.keepOriginal,
        autoCompress: body.autoCompress,
        compressionThreshold: body.compressionThreshold,
      },
    })

    return NextResponse.json(settings)
  } catch (error) {
    console.error('Failed to update compression settings:', error)
    return NextResponse.json(
      { error: 'Failed to update compression settings' },
      { status: 500 }
    )
  }
}
