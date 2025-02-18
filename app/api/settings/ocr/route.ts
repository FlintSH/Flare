import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { ocrQueue } from '@/lib/ocr'

export async function POST() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user || session.user.role !== 'ADMIN') {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    // Get all unprocessed image files
    const files = await prisma.file.findMany({
      where: {
        isOcrProcessed: false,
        mimeType: {
          startsWith: 'image/',
        },
      },
      select: {
        id: true,
        path: true,
        name: true,
      },
    })

    console.log(
      `Found ${files.length} unprocessed image files to queue for OCR`
    )

    // Queue each file for OCR processing
    for (const file of files) {
      await ocrQueue.add({
        filePath: file.path,
        fileId: file.id,
      })
      console.log(`Queued OCR processing for ${file.name}`)
    }

    return NextResponse.json({
      success: true,
      queuedFiles: files.length,
    })
  } catch (error) {
    console.error('Error queueing OCR processing:', error)
    return NextResponse.json(
      { error: 'Failed to queue OCR processing' },
      { status: 500 }
    )
  }
}
