import { NextResponse } from 'next/server'

import { PrismaClient } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { join } from 'path'
import sharp from 'sharp'

import { authOptions } from '@/lib/auth'
import { getConfig } from '@/lib/config'
import { S3StorageProvider, getStorageProvider } from '@/lib/storage'

const prisma = new PrismaClient()

export async function POST(req: Request) {
  try {
    // Check auth
    const session = await getServerSession(authOptions)
    if (session?.user?.role !== 'ADMIN') {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    // Get the file from the request and buffer it
    const formData = await req.formData()
    const file = formData.get('file') as File
    if (!file) {
      return new NextResponse('No file provided', { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    // Resize image to be favicon friendly
    const processedBuffer = await sharp(buffer).resize(32, 32).png().toBuffer()

    const storageProvider = await getStorageProvider()
    const faviconPath = join('uploads', 'favicon.png')
    let publicPath = '/api/favicon'

    // Delete old favicon if it exists
    const config = await getConfig()
    if (config.settings.appearance.favicon) {
      try {
        const oldPath = join('uploads', 'favicon.png')
        await storageProvider.deleteFile(oldPath)
      } catch (error) {
        console.error('Failed to delete old favicon:', error)
      }
    }

    // Upload the new favicon
    await storageProvider.uploadFile(processedBuffer, faviconPath, 'image/png')

    // If using S3, get the direct URL
    if (storageProvider instanceof S3StorageProvider) {
      publicPath = await storageProvider.getFileUrl(faviconPath)
    }

    // Update the config to store the favicon path
    config.settings.appearance.favicon = publicPath

    // Save the updated config to the database
    await prisma.config.update({
      where: { key: 'flare_config' },
      data: { value: config },
    })

    // Also save to the config file for backwards compatibility
    await storageProvider.uploadFile(
      Buffer.from(JSON.stringify(config, null, 2)),
      join(process.cwd(), 'flare.config.json'),
      'application/json'
    )

    return new NextResponse('Favicon updated successfully', { status: 200 })
  } catch (error) {
    console.error('Error updating favicon:', error)
    return new NextResponse('Internal server error', { status: 500 })
  }
}
