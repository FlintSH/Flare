import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'
import { join } from 'path'
import sharp from 'sharp'

import { authOptions } from '@/lib/auth'
import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { S3StorageProvider, getStorageProvider } from '@/lib/storage'
import { bytesToMB } from '@/lib/utils'

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'File must be an image' },
        { status: 400 }
      )
    }

    // Get user's current storage usage and quota if enabled
    const config = await getConfig()
    const quotasEnabled = config.settings.general.storage.quotas.enabled
    const defaultQuota = config.settings.general.storage.quotas.default

    if (quotasEnabled && session.user.role !== 'ADMIN') {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { storageUsed: true },
      })

      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 400 })
      }

      const quotaMB =
        defaultQuota.value * (defaultQuota.unit === 'GB' ? 1024 : 1)
      const fileSizeMB = bytesToMB(file.size)

      if (user.storageUsed + fileSizeMB > quotaMB) {
        return NextResponse.json(
          {
            error: 'Storage quota exceeded',
            message: `You have reached your storage quota of ${defaultQuota.value}${defaultQuota.unit}`,
          },
          { status: 413 }
        )
      }
    }

    // Get current user to check for existing avatar
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { image: true },
    })

    // process the image to be 256x256
    const bytes = await file.arrayBuffer()
    const processedImage = await sharp(Buffer.from(bytes))
      .resize(256, 256, {
        fit: 'cover',
        position: 'center',
      })
      .toBuffer()

    const storageProvider = await getStorageProvider()
    const avatarPath = join('uploads', 'avatars', `${session.user.id}.jpg`)
    let publicPath = `/api/avatars/${session.user.id}.jpg`

    // Delete old avatar if it exists
    if (user?.image?.startsWith('/api/avatars/')) {
      try {
        const oldPath = join(
          'uploads',
          'avatars',
          user.image.split('/').pop() || ''
        )
        await storageProvider.deleteFile(oldPath)
      } catch (error) {
        console.error('Failed to delete old avatar:', error)
      }
    }

    // Upload new avatar
    await storageProvider.uploadFile(processedImage, avatarPath, 'image/jpeg')

    // If using S3, get the direct URL
    if (storageProvider instanceof S3StorageProvider) {
      publicPath = await storageProvider.getFileUrl(avatarPath)
    }

    // Update user record with the public URL
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        image: publicPath,
      },
    })

    return NextResponse.json({ success: true, url: publicPath })
  } catch (error) {
    console.error('Avatar upload error:', error)
    return NextResponse.json(
      { error: 'Failed to upload avatar' },
      { status: 500 }
    )
  }
}
