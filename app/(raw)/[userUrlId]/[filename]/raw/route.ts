import { NextResponse } from 'next/server'

import { compare } from 'bcryptjs'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { S3StorageProvider, getStorageProvider } from '@/lib/storage'

// Helper function to encode filename for Content-Disposition header
function encodeFilename(filename: string): string {
  // First encode as URI component to handle special characters
  const encoded = encodeURIComponent(filename)
  // Then wrap in quotes and escape quotes and backslashes in filename
  return `"${encoded.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ userUrlId: string; filename: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    const { userUrlId, filename } = await params
    const urlPath = `/${userUrlId}/${filename}`
    const url = new URL(req.url)
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
    const isPrivate = file.visibility === 'PRIVATE' && !session?.user

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
    const range = req.headers.get('range')

    // Get file size for range calculations
    const size = await storageProvider.getFileSize(file.path)

    // Add common headers for all responses
    const commonHeaders = {
      'Accept-Ranges': 'bytes',
      'Content-Type': file.mimeType,
      'Content-Disposition': `inline; filename=${encodeFilename(file.name)}`,
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    }

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)

      let end = parts[1]
        ? parseInt(parts[1], 10)
        : Math.min(start + 1024 * 1024, size - 1)

      end = Math.min(end, size - 1)

      const chunkSize = end - start + 1

      if (
        isNaN(start) ||
        isNaN(end) ||
        start >= size ||
        end >= size ||
        start > end
      ) {
        return new Response(null, {
          status: 416,
          headers: {
            ...commonHeaders,
            'Content-Range': `bytes */${size}`,
          },
        })
      }

      if (storageProvider instanceof S3StorageProvider) {
        // For S3, we'll still use direct URLs but include the range header
        const fileUrl = await storageProvider.getFileUrl(file.path)
        const response = await fetch(fileUrl, {
          headers: {
            Range: `bytes=${start}-${end}`,
          },
        })

        const headers = {
          ...commonHeaders,
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': chunkSize.toString(),
        }

        return new NextResponse(response.body, {
          status: 206,
          headers,
        })
      }

      const stream = await storageProvider.getFileStream(file.path, {
        start,
        end,
      })

      const headers = {
        ...commonHeaders,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': chunkSize.toString(),
      }

      return new NextResponse(stream as unknown as ReadableStream, {
        status: 206,
        headers,
      })
    }

    // No range requested
    if (storageProvider instanceof S3StorageProvider) {
      const stream = await storageProvider.getFileStream(file.path)
      return new NextResponse(stream as unknown as ReadableStream, {
        headers: {
          ...commonHeaders,
          'Content-Length': size.toString(),
        },
      })
    }

    // For local files, serve entire file
    const stream = await storageProvider.getFileStream(file.path)
    const headers = {
      ...commonHeaders,
      'Content-Length': size.toString(),
    }

    return new NextResponse(stream as unknown as ReadableStream, { headers })
  } catch (error) {
    console.error('File serve error:', error)
    return new Response(null, { status: 500 })
  }
}
