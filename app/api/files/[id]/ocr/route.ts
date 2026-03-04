import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { checkFileAccess } from '@/lib/files/access'
import { loggers } from '@/lib/logger'
import { processImageOCR } from '@/lib/ocr'

const logger = loggers.files

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const url = new URL(req.url)
    const providedPassword = url.searchParams.get('password')

    const file = await prisma.file.findUnique({
      where: { id },
      select: {
        userId: true,
        mimeType: true,
        isOcrProcessed: true,
        ocrText: true,
        path: true,
        ocrConfidence: true,
        visibility: true,
        password: true,
      },
    })

    if (!file) {
      return NextResponse.json(
        {
          success: false,
          error: 'File not found',
        },
        { status: 404 }
      )
    }

    if (!file.mimeType.startsWith('image/')) {
      return NextResponse.json(
        {
          success: false,
          error: 'File is not an image',
        },
        { status: 400 }
      )
    }

    const session = await getServerSession(authOptions)

    const access = await checkFileAccess(file, session, providedPassword)
    if (!access.allowed) {
      return NextResponse.json(
        {
          success: false,
          error:
            access.reason === 'private' ? 'Unauthorized' : 'Password required',
        },
        { status: access.status }
      )
    }

    if (!file.isOcrProcessed || (file.isOcrProcessed && !file.ocrText)) {
      const result = await processImageOCR(file.path, id)

      if (result.success && result.text) {
        await prisma.file.update({
          where: { id },
          data: {
            isOcrProcessed: true,
            ocrText: result.text,
            ocrConfidence: result.confidence,
          },
        })
      }

      return NextResponse.json(result)
    }

    return NextResponse.json({
      success: true,
      text: file.ocrText,
      confidence: file.ocrConfidence,
    })
  } catch (error) {
    logger.error('OCR fetch error:', error as Error)
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to fetch OCR text',
      },
      { status: 500 }
    )
  }
}
