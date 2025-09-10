import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'
import { join } from 'path'

import { authOptions } from '@/lib/auth'
import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { S3StorageProvider, getStorageProvider } from '@/lib/storage'
import { bytesToMB } from '@/lib/utils'

const logger = loggers.users

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

    if (!file.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'File must be an image' },
        { status: 400 }
      )
    }

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

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { image: true },
    })

    const bytes = await file.arrayBuffer()
    const processedImage = Buffer.from(bytes)

    const storageProvider = await getStorageProvider()
    const avatarFilename = `${session.user.id}.jpg`
    const avatarPath = join('uploads', 'avatars', avatarFilename)
    let publicPath = `/api/avatars/${avatarFilename}`

    if (user?.image?.startsWith('/api/avatars/')) {
      try {
        const oldFilename = user.image.split('/').pop()
        if (oldFilename) {
          const oldPath = join('uploads', 'avatars', oldFilename)
          await storageProvider.deleteFile(oldPath)
        }
      } catch (error) {
        logger.error('Failed to delete old avatar', error as Error, {
          userId: session.user.id,
          oldPath: user.image,
        })
      }
    }

    await storageProvider.uploadFile(processedImage, avatarPath, 'image/jpeg')

    if (storageProvider instanceof S3StorageProvider) {
      publicPath = await storageProvider.getFileUrl(avatarPath)
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        image: publicPath,
      },
    })

    return NextResponse.json({ success: true, url: publicPath })
  } catch (error) {
    logger.error('Avatar upload error', error as Error)
    return NextResponse.json(
      { error: 'Failed to upload avatar' },
      { status: 500 }
    )
  }
}
