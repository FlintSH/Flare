import { NextRequest, NextResponse } from 'next/server'

import { join } from 'path'

import { S3StorageProvider, getStorageProvider } from '@/lib/storage'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params
    const filepath = join('avatars', filename)

    const storageProvider = await getStorageProvider()

    if (storageProvider instanceof S3StorageProvider) {
      const fileUrl = await storageProvider.getFileUrl(filepath)
      return NextResponse.redirect(fileUrl)
    }

    const localFilepath = join('uploads', filepath)
    const stream = await storageProvider.getFileStream(localFilepath)

    return new NextResponse(stream as unknown as ReadableStream, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (error) {
    console.error('Avatar serve error:', error)
    return new Response(null, { status: 500 })
  }
}
