import { NextRequest, NextResponse } from 'next/server'

import { compare } from 'bcryptjs'
import { stat } from 'fs/promises'
import { getServerSession } from 'next-auth'
import { join } from 'path'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { S3StorageProvider, getStorageProvider } from '@/lib/storage'

// These are all mime types that need to be streamed for the embedded file viewer to work
const STREAM_MIME_TYPES = [
  'text/plain',
  'text/html',
  'text/css',
  'text/javascript',
  'text/typescript',
  'text/csv',
  'text/markdown',
  'text/x-python',
  'text/x-java',
  'text/x-c',
  'text/x-cpp',
  'text/x-ruby',
  'text/x-go',
  'text/x-rust',
  'text/x-php',
  'text/x-sql',
  'text/xml',
  'text/yaml',
  'text/x-toml',
  'application/json',
  'application/javascript',
  'application/typescript',
  'application/x-httpd-php',
  'application/xml',
  'application/yaml',
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/x-flv',
  'video/3gpp',
  'video/3gpp2',
]

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<Response> {
  try {
    const { path } = await params
    const session = await getServerSession(authOptions)
    const urlPath = '/' + path.join('/')
    const url = new URL(request.url)
    const providedPassword = url.searchParams.get('password')

    // Find the file
    const file = await prisma.file.findUnique({
      where: { urlPath },
    })

    if (!file) {
      return new Response(null, { status: 404 })
    }

    // Check if file is accessible
    const isOwner = session?.user?.id === file.userId
    const isPrivate = file.visibility === 'PRIVATE' && !isOwner

    if (isPrivate) {
      return new Response(null, { status: 404 })
    }

    // Check password if set
    if (file.password && !isOwner) {
      if (!providedPassword) {
        return new Response(null, { status: 404 })
      }

      const isPasswordValid = await compare(providedPassword, file.password)
      if (!isPasswordValid) {
        return new Response(null, { status: 404 })
      }
    }

    const storageProvider = await getStorageProvider()

    if (storageProvider instanceof S3StorageProvider) {
      const shouldStream = STREAM_MIME_TYPES.some(
        (type) => file.mimeType.startsWith(type) || file.mimeType === type
      )

      if (!shouldStream) {
        const stream = await storageProvider.getFileStream(file.path)
        return new NextResponse(stream as unknown as ReadableStream, {
          headers: {
            'Content-Type': file.mimeType,
            'Content-Disposition': `inline; filename="${file.name}"`,
            'Content-Length': (await storageProvider.getFileSize(file.path)).toString(),
          },
        })
      }
    }

    // Handle range requests for video files
    const range = request.headers.get('range')
    const isVideo = file.mimeType.startsWith('video/')

    if (range && isVideo) {
      const filePath = file.path
      const { size } = await stat(join(process.cwd(), filePath))
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
        'Content-Disposition': `inline; filename="${file.name}"`,
      }

      return new NextResponse(stream as unknown as ReadableStream, {
        status: 206,
        headers,
      })
    }

    const stream = await storageProvider.getFileStream(file.path)

    return new Response(stream as unknown as ReadableStream, {
      headers: {
        'Content-Type': file.mimeType,
        'Content-Disposition': `inline; filename="${file.name}"`,
        'Accept-Ranges': 'bytes',
      },
    })
  } catch (error) {
    console.error('File serve error:', error)
    return new Response(null, { status: 404 })
  }
}
