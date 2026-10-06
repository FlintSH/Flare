import { NextResponse } from 'next/server'

import { setAuditOutcome, setAuditTarget, withAuditRoute } from '@/lib/audit'
import { getAccessSession } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { checkFileAccess } from '@/lib/files/access'
import { loggers } from '@/lib/logger'
import { processImageOCR } from '@/lib/ocr'
import { applyPendingOcrTags } from '@/lib/tags/ocr'

const logger = loggers.files

async function handleGET(
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
        id: true,
        name: true,
        userId: true,
        mimeType: true,
        isOcrProcessed: true,
        ocrText: true,
        path: true,
        ocrConfidence: true,
        ocrTagsPendingAt: true,
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

    const session = await getAccessSession()

    setAuditTarget({ type: 'file', id: file.id, name: file.name })
    const access = await checkFileAccess(file, session, providedPassword)
    if (!access.allowed) {
      setAuditOutcome('denied')
      return NextResponse.json(
        {
          success: false,
          error:
            access.reason === 'private' ? 'Unauthorized' : 'Password required',
        },
        { status: access.status }
      )
    }

    if (!file.isOcrProcessed || file.ocrText === null) {
      const result = await processImageOCR(file.path, id)

      return NextResponse.json(result)
    }

    if (file.ocrTagsPendingAt) await applyPendingOcrTags(id)

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
        error: 'Failed to fetch OCR text',
      },
      { status: 500 }
    )
  }
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  return withAuditRoute(async () => handleGET(req, context), {
    route: '/api/files/[id]/ocr',
  })(req)
}
