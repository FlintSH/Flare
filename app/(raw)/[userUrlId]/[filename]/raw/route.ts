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

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : size - 1
      const chunkSize = end - start + 1

      if (storageProvider instanceof S3StorageProvider) {
        // For S3, we'll still use direct URLs but include the range header
        const fileUrl = await storageProvider.getFileUrl(file.path)
        const response = await fetch(fileUrl, {
          headers: {
            Range: `bytes=${start}-${end}`,
          },
        })

        const headers = {
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize.toString(),
          'Content-Type': file.mimeType,
          'Content-Disposition': `inline; filename=${encodeFilename(file.name)}`,
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
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize.toString(),
        'Content-Type': file.mimeType,
        'Content-Disposition': `inline; filename=${encodeFilename(file.name)}`,
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
          'Accept-Ranges': 'bytes',
          'Content-Length': size.toString(),
          'Content-Type': file.mimeType,
          'Content-Disposition': `inline; filename=${encodeFilename(file.name)}`,
        },
      })
    }

    // For local files, serve entire file
    const stream = await storageProvider.getFileStream(file.path)
    const headers = {
      'Accept-Ranges': 'bytes',
      'Content-Length': size.toString(),
      'Content-Type': file.mimeType,
      'Content-Disposition': `inline; filename=${encodeFilename(file.name)}`,
    }

    return new NextResponse(stream as unknown as ReadableStream, { headers })
  } catch (error) {
    console.error('File serve error:', error)
    return new Response(null, { status: 500 })
  }
}
