import { NextResponse } from 'next/server'

import { compare } from 'bcryptjs'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { processImageOCR } from '@/lib/ocr'

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
    const isOwner = session?.user?.id === file.userId

    if (file.visibility === 'PRIVATE' && !isOwner) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized',
        },
        { status: 401 }
      )
    }

    if (file.password && !isOwner) {
      if (!providedPassword) {
        return NextResponse.json(
          {
            success: false,
            error: 'Password required',
          },
          { status: 401 }
        )
      }

      const isPasswordValid = await compare(providedPassword, file.password)
      if (!isPasswordValid) {
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid password',
          },
          { status: 401 }
        )
      }
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
    console.error('OCR fetch error:', error)
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
