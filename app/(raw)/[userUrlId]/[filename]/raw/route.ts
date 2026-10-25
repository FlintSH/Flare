import { NextResponse } from 'next/server'

import { once } from 'node:events'
import { ReadStream } from 'node:fs'
import { Readable } from 'stream'

import { setAuditOutcome, setAuditTarget, withAuditRoute } from '@/lib/audit'
import { getAccessSession } from '@/lib/auth'
import { requestIp } from '@/lib/auth/security/shared'
import { prisma } from '@/lib/database/prisma'
import { checkFileAccess, fileAccessDeniedHeaders } from '@/lib/files/access'
import { resolveFileUrlPath } from '@/lib/files/resolve'
import { loggers } from '@/lib/logger'
import { sanitizeDisplayName } from '@/lib/security/paths'
import { getStorageProvider } from '@/lib/storage'

const logger = loggers.files

function encodeFilename(filename: string): string {
  const safe = sanitizeDisplayName(filename)
  const encoded = encodeURIComponent(safe)
  return `"${encoded.replace(/["\\]/g, '\\$&')}"; filename*=UTF-8''${encoded}`
}

function createRobustStream(nodeStream: Readable): ReadableStream {
  let streamClosed = false
  let controller: ReadableStreamDefaultController | null = null

  return new ReadableStream({
    start(ctrl) {
      controller = ctrl

      nodeStream.on('data', (chunk) => {
        if (!streamClosed) {
          try {
            controller?.enqueue(new Uint8Array(chunk))
          } catch (error) {
            logger.error('Error enqueueing chunk:', error as Error)
            if (!streamClosed) {
              controller?.error(error)
              streamClosed = true
            }
          }
        }
      })

      nodeStream.on('end', () => {
        if (!streamClosed) {
          try {
            controller?.close()
          } catch (error) {
            logger.error('Error closing stream:', error as Error)
          }
          streamClosed = true
        }
      })

      nodeStream.on('error', (error) => {
        logger.error('Node stream error:', error as Error)
        if (!streamClosed) {
          controller?.error(error)
          streamClosed = true
        }
      })

      nodeStream.resume()
    },

    cancel() {
      streamClosed = true
      if (nodeStream.destroyed === false) {
        nodeStream.destroy()
      }
    },
  })
}

async function createFileResponse(
  nodeStream: Readable,
  req: Request,
  fileId: string,
  init: ResponseInit
): Promise<NextResponse> {
  let streamError: Error | null = nodeStream.errored
  const onError = (error: Error) => {
    streamError = error
  }

  // Keep errors handled and bytes paused until local open and the counter write
  // finish. createReadStream returns before its asynchronous open completes.
  nodeStream.on('error', onError)
  nodeStream.pause()

  try {
    if (nodeStream.destroyed) {
      throw streamError ?? new Error('Storage stream closed before serving')
    }
    if (nodeStream instanceof ReadStream && nodeStream.pending) {
      await once(nodeStream, 'open')
    }
    if (streamError) throw streamError

    // Validate headers before counting a request that cannot produce a response.
    const headers = new Headers(init.headers)
    if (req.method === 'GET') {
      await prisma.file.update({
        where: { id: fileId },
        data: { views: { increment: 1 } },
      })
    }
    if (streamError) throw streamError

    const response = new NextResponse(createRobustStream(nodeStream), {
      ...init,
      headers,
    })
    // The response body now owns error handling and cancellation.
    nodeStream.off('error', onError)
    return response
  } catch (error) {
    if (nodeStream.closed) {
      nodeStream.off('error', onError)
    } else {
      // Retain the listener through asynchronous destruction/descriptor closure.
      nodeStream.once('close', () => nodeStream.off('error', onError))
      nodeStream.destroy()
    }
    throw error
  }
}

async function handleGET(
  req: Request,
  { params }: { params: Promise<{ userUrlId: string; filename: string }> }
) {
  try {
    const session = await getAccessSession()
    const { userUrlId, filename } = await params
    const url = new URL(req.url)
    const providedPassword = url.searchParams.get('password')

    const urlPath = await resolveFileUrlPath(userUrlId, filename)

    if (!urlPath) {
      return new Response(null, { status: 404 })
    }

    const file = await prisma.file.findUnique({
      where: { urlPath },
    })

    if (!file) {
      return new Response(null, { status: 404 })
    }

    setAuditTarget({ type: 'file', id: file.id, name: file.name })

    const access = await checkFileAccess(file, session, providedPassword, {
      requester: requestIp(req.headers),
    })
    if (!access.allowed) {
      setAuditOutcome('denied')
      return new Response(null, {
        status: access.status,
        headers: fileAccessDeniedHeaders(access),
      })
    }

    const storageProvider = await getStorageProvider()
    const range = req.headers.get('range')

    const size = await storageProvider.getFileSize(file.path)

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : size - 1
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
        'Content-Disposition': `inline; filename=${encodeFilename(file.name)}`,
        'Content-Security-Policy': 'sandbox',
        'X-Content-Type-Options': 'nosniff',
        Connection: 'keep-alive',
        'Keep-Alive': 'timeout=300, max=1000',
      }

      return await createFileResponse(stream, req, file.id, {
        status: 206,
        headers,
      })
    }

    const stream = await storageProvider.getFileStream(file.path)
    const headers = {
      'Accept-Ranges': 'bytes',
      'Content-Length': size.toString(),
      'Content-Type': file.mimeType,
      'Content-Disposition': `inline; filename=${encodeFilename(file.name)}`,
      'Content-Security-Policy': 'sandbox',
      'X-Content-Type-Options': 'nosniff',
      Connection: 'keep-alive',
      'Keep-Alive': 'timeout=300, max=1000',
    }

    return await createFileResponse(stream, req, file.id, { headers })
  } catch (error) {
    logger.error('File serve error:', error as Error)
    if (error instanceof Error && error.message.includes('NoSuchKey')) {
      return new Response(null, { status: 404 })
    }
    return new Response(null, { status: 500 })
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ userUrlId: string; filename: string }> }
) {
  return withAuditRoute(async () => handleGET(req, { params }), {
    action: 'file.read',
    category: 'files',
    route: '/[userUrlId]/[filename]/raw',
  })(req)
}
