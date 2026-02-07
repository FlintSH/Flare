import { NextResponse } from 'next/server'

import { compare } from 'bcryptjs'
import { getServerSession } from 'next-auth'
import { Readable } from 'stream'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { resolveFileUrlPath } from '@/lib/files/resolve'
import { getStorageProvider } from '@/lib/storage'

function encodeFilename(filename: string): string {
  const encoded = encodeURIComponent(filename)
  return `"${encoded.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
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
            console.error('Error enqueueing chunk:', error)
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
            console.error('Error closing stream:', error)
          }
          streamClosed = true
        }
      })

      nodeStream.on('error', (error) => {
        console.error('Node stream error:', error)
        if (!streamClosed) {
          controller?.error(error)
          streamClosed = true
        }
      })
    },

    cancel() {
      streamClosed = true
      if (nodeStream.destroyed === false) {
        nodeStream.destroy()
      }
    },
  })
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ userUrlId: string; filename: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
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

    const isOwner = session?.user?.id === file.userId
    const isPrivate = file.visibility === 'PRIVATE' && !session?.user

    if (isPrivate) {
      return new Response(null, { status: 404 })
    }

    if (file.password && !isOwner) {
      if (!providedPassword) {
        return new Response(null, { status: 401 })
      }

      const isPasswordValid = await compare(providedPassword, file.password)
      if (!isPasswordValid) {
        return new Response(null, { status: 401 })
      }
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
        Connection: 'keep-alive',
        'Keep-Alive': 'timeout=300, max=1000',
      }

      return new NextResponse(createRobustStream(stream), {
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
      Connection: 'keep-alive',
      'Keep-Alive': 'timeout=300, max=1000',
    }

    return new NextResponse(createRobustStream(stream), { headers })
  } catch (error) {
    console.error('File serve error:', error)
    if (error instanceof Error && error.message.includes('NoSuchKey')) {
      return new Response(null, { status: 404 })
    }
    return new Response(null, { status: 500 })
  }
}
