import { NextRequest, NextResponse } from 'next/server'

import { setAuditOutcome, setAuditTarget, withAuditRoute } from '@/lib/audit'
import { getAccessSession } from '@/lib/auth'
import { requestIp } from '@/lib/auth/security/shared'
import { prisma } from '@/lib/database/prisma'
import { checkFileAccess, fileAccessDeniedHeaders } from '@/lib/files/access'
import { parseByteRange } from '@/lib/http/byte-range'
import { loggers } from '@/lib/logger'
import { sanitizeDisplayName } from '@/lib/security/paths'
import { getStorageProvider } from '@/lib/storage'

const logger = loggers.files

function encodeFilename(filename: string): string {
  const safe = sanitizeDisplayName(filename)
  const encoded = encodeURIComponent(safe)
  return `"${encoded.replace(/["\\]/g, '\\$&')}"; filename*=UTF-8''${encoded}`
}

async function handleGET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  try {
    const { path } = await params
    const session = await getAccessSession()
    const urlPath = '/' + path.join('/')
    const url = new URL(request.url)
    const providedPassword = url.searchParams.get('password')
    const isDownloadRequest = url.searchParams.get('download') === 'true'

    let file = await prisma.file.findUnique({
      where: { urlPath },
    })

    if (!file && urlPath.includes(' ')) {
      const urlSafePath = urlPath.replace(/ /g, '-')
      file = await prisma.file.findUnique({
        where: { urlPath: urlSafePath },
      })
    }

    if (!file) {
      return new Response(null, { status: 404 })
    }

    setAuditTarget({ type: 'file', id: file.id, name: file.name })

    const access = await checkFileAccess(file, session, providedPassword, {
      requester: requestIp(request.headers),
    })
    if (!access.allowed) {
      setAuditOutcome('denied')
      return new Response(null, {
        status: access.status,
        headers: {
          'Cache-Control': 'private, no-store',
          ...fileAccessDeniedHeaders(access),
        },
      })
    }

    if (isDownloadRequest) {
      await prisma.file.update({
        where: { id: file.id },
        data: { downloads: { increment: 1 } },
      })
    }

    const storageProvider = await getStorageProvider()
    // A shared cache keys on the URL alone, so only public, unprotected bytes
    // may be stored; otherwise one authorized read would serve everyone.
    const cacheControl =
      file.visibility === 'PRIVATE' || file.password
        ? 'private, no-store'
        : file.mimeType.startsWith('video/')
          ? 'public, max-age=31536000'
          : 'no-cache'
    const range = request.headers.get('range')
    const size = await storageProvider.getFileSize(file.path)

    const byteRange = parseByteRange(range, size)
    if (byteRange === 'unsatisfiable') {
      return new Response(null, {
        status: 416,
        headers: {
          'Content-Range': `bytes */${size}`,
          'Accept-Ranges': 'bytes',
          'Content-Security-Policy': 'sandbox',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }
    if (byteRange) {
      const { start, end } = byteRange
      const chunkSize = end - start + 1

      const stream = await storageProvider.getFileStream(file.path, {
        start,
        end,
      })

      const headers = {
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize.toString(),
        'Content-Type': file.mimeType,
        'Content-Disposition': `${isDownloadRequest ? 'attachment' : 'inline'}; filename=${encodeFilename(file.name)}`,
        'Content-Security-Policy': 'sandbox',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': cacheControl,
      }

      return new NextResponse(stream as unknown as ReadableStream, {
        status: 206,
        headers,
      })
    }

    const stream = await storageProvider.getFileStream(file.path)
    const headers = {
      'Content-Type': file.mimeType,
      'Content-Disposition': `${isDownloadRequest ? 'attachment' : 'inline'}; filename=${encodeFilename(file.name)}`,
      'Content-Security-Policy': 'sandbox',
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'bytes',
      'Content-Length': size.toString(),
      'Cache-Control': cacheControl,
    }

    return new NextResponse(stream as unknown as ReadableStream, {
      headers,
    })
  } catch (error) {
    logger.error('File serve error:', error as Error)
    return new Response(null, { status: 404 })
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  return withAuditRoute(async () => handleGET(request, { params }), {
    // The downloads counter is not a separate change event, so the request
    // event records whether this was a download.
    action:
      new URL(request.url).searchParams.get('download') === 'true'
        ? 'file.download'
        : 'file.read',
    category: 'files',
    route: '/api/files/[...path]',
  })(request)
}
