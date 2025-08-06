import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'
import sharp from 'sharp'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { getStorageProvider } from '@/lib/storage'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const [session, { id }] = await Promise.all([
      getServerSession(authOptions),
      params,
    ])

    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const file = await prisma.file.findUnique({
      where: {
        id,
        ...(session.user.role !== 'ADMIN' && { userId: session.user.id }),
      },
      select: {
        mimeType: true,
        path: true,
      },
    })

    if (!file) {
      return new NextResponse('File not found', { status: 404 })
    }

    if (!file.mimeType.startsWith('image/')) {
      return new NextResponse('Not an image', { status: 400 })
    }

    const storageProvider = await getStorageProvider()
    const fileStream = await storageProvider.getFileStream(file.path)

    const chunks: Buffer[] = []
    for await (const chunk of fileStream) {
      chunks.push(Buffer.from(chunk))
    }
    const fileBuffer = Buffer.concat(chunks)

    const imageBuffer = await sharp(fileBuffer)
      .resize(400, 400, {
        fit: 'cover',
        position: 'center',
      })
      .toBuffer()

    return new NextResponse(imageBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': file.mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (error) {
    console.error('Error generating thumbnail:', error)
    return new NextResponse('Error generating thumbnail', { status: 500 })
  }
}
