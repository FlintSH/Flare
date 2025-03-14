import { NextRequest, NextResponse } from 'next/server'

import { compare } from 'bcryptjs'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { getStorageProvider } from '@/lib/storage'

// Helper function to encode filename for Content-Disposition header
function encodeFilename(filename: string): string {
  // First encode as URI component to handle special characters
  const encoded = encodeURIComponent(filename)
  // Then wrap in quotes and escape quotes and backslashes in filename
  return `"${encoded.replace(/["\\]/g, '\\$&')}"`
}

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
        return new Response(null, { status: 401 })
      }

      const isPasswordValid = await compare(providedPassword, file.password)
      if (!isPasswordValid) {
        return new Response(null, { status: 401 })
      }
    }

    const storageProvider = await getStorageProvider()
    const isVideo = file.mimeType.startsWith('video/')
    const range = request.headers.get('range')
    const size = await storageProvider.getFileSize(file.path)

    // Handle range requests (especially important for video files)
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
        'Cache-Control': isVideo ? 'public, max-age=31536000' : 'no-cache',
      }

      return new NextResponse(stream as unknown as ReadableStream, {
        status: 206,
        headers,
      })
    }

    // No range requested
    const stream = await storageProvider.getFileStream(file.path)
    const headers = {
      'Content-Type': file.mimeType,
      'Content-Disposition': `inline; filename=${encodeFilename(file.name)}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': size.toString(),
      'Cache-Control': isVideo ? 'public, max-age=31536000' : 'no-cache',
    }

    return new NextResponse(stream as unknown as ReadableStream, { headers })
  } catch (error) {
    console.error('File serve error:', error)
    return new Response(null, { status: 404 })
  }
}
