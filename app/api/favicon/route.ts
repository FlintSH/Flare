import { NextResponse } from 'next/server'

import { join } from 'path'

import { S3StorageProvider, getStorageProvider } from '@/lib/storage'

export async function GET() {
  try {
    const filepath = join('uploads', 'favicon.png')
    const storageProvider = await getStorageProvider()

    if (storageProvider instanceof S3StorageProvider) {
      const fileUrl = await storageProvider.getFileUrl(filepath)
      return NextResponse.redirect(fileUrl)
    }

    const stream = await storageProvider.getFileStream(filepath)

    return new NextResponse(stream as unknown as ReadableStream, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (error) {
    console.error('Favicon serve error:', error)
    return new Response(null, { status: 500 })
  }
}
