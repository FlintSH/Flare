import { NextResponse } from 'next/server'

import { setAuditOutcome, setAuditTarget, withAuditRoute } from '@/lib/audit'
import { getAccessSession } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { checkFileAccess } from '@/lib/files/access'
import { loggers } from '@/lib/logger'
import { ocrQueue } from '@/lib/ocr'
import { takeOcrRequest } from '@/lib/ocr/limits'
import { getClientIp } from '@/lib/security/rate-limit'
import { applyPendingOcrTags } from '@/lib/tags/ocr'

const logger = loggers.files

// Storage and recognition errors can name internal paths; never return them.
const RECOGNITION_FAILED = 'Flare couldn’t read text from this image.'

function retryLater(
  status: number,
  retryAfter: number,
  body: Record<string, unknown>
) {
  return NextResponse.json(
    { success: false, retryAfter, ...body },
    { status, headers: { 'Retry-After': String(retryAfter) } }
  )
}

async function recognize(
  req: Request,
  file: { id: string; path: string },
  userId: string | undefined
) {
  const outcome = await ocrQueue.request(
    { fileId: file.id, filePath: file.path },
    {
      admit: () =>
        takeOcrRequest(userId ? `user:${userId}` : `ip:${getClientIp(req)}`),
    }
  )
  switch (outcome.status) {
    case 'done':
      return outcome.result.success
        ? NextResponse.json(outcome.result)
        : NextResponse.json({ success: false, error: RECOGNITION_FAILED })
    case 'pending':
      return retryLater(202, 30, {
        status: 'processing',
        error:
          'Flare is still reading this image. Check again in a moment to see the text.',
      })
    case 'busy':
      return retryLater(503, 60, {
        error: 'Flare is busy reading other images. Try again in a minute.',
      })
    case 'limited':
      return retryLater(429, outcome.retryAfterSeconds, {
        error: `You’ve asked Flare to read several images in a short time. Try again in ${waitText(outcome.retryAfterSeconds)}.`,
      })
    case 'failed-recently': {
      const retryAfter = Math.ceil(outcome.retryAfterMs / 1000)
      return NextResponse.json({
        success: false,
        retryAfter,
        error: `${RECOGNITION_FAILED} Try again in ${waitText(retryAfter)}.`,
      })
    }
  }
}

function waitText(seconds: number) {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}

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

    if (!file.isOcrProcessed || file.ocrText === null)
      return await recognize(req, file, session?.user?.id)

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
