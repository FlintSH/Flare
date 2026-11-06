import { NextResponse } from 'next/server'

import { setAuditOutcome, setAuditTarget } from '@/lib/audit'
import { getAccessSession } from '@/lib/auth'
import { requestIp } from '@/lib/auth/security/shared'
import { prisma } from '@/lib/database/prisma'
import { checkFileAccess, fileAccessDeniedHeaders } from '@/lib/files/access'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { getStorageProvider } from '@/lib/storage'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/files/[id]/thumbnail', {
  failure: { message: 'Error serving thumbnail' },
  logger: loggers.files,
})

export const GET = api(
  async (request, { params }: Context) => {
    const [session, { id }] = await Promise.all([getAccessSession(), params])

    const url = new URL(request.url)
    const providedPassword = url.searchParams.get('password')

    const file = await prisma.file.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        mimeType: true,
        path: true,
        visibility: true,
        userId: true,
        password: true,
      },
    })

    if (!file) {
      return new NextResponse('File not found', { status: 404 })
    }

    if (!file.mimeType.startsWith('image/')) {
      return new NextResponse('Not an image', { status: 400 })
    }

    setAuditTarget({ type: 'file', id: file.id, name: file.name })

    const access = await checkFileAccess(file, session, providedPassword, {
      requester: requestIp(request.headers),
    })
    if (!access.allowed) {
      setAuditOutcome('denied')
      return new NextResponse(null, {
        status: access.status,
        headers: {
          'Cache-Control': 'private, no-store',
          ...fileAccessDeniedHeaders(access),
        },
      })
    }

    const storageProvider = await getStorageProvider()
    const fileStream = await storageProvider.getFileStream(file.path)

    // Just serve the original image - let the browser/CSS handle sizing.
    // The stored type is client-supplied and can be an active document such
    // as SVG, so a direct visit must not run script on the Flare origin.
    return new NextResponse(fileStream as unknown as BodyInit, {
      headers: {
        'Content-Type': file.mimeType,
        'Content-Security-Policy': 'sandbox',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control':
          file.visibility === 'PRIVATE' || file.password
            ? 'private, no-store'
            : 'public, max-age=31536000, immutable',
      },
    })
  },
  { audit: { action: 'file.thumbnail', category: 'files' } }
)
