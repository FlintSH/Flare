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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    const { id: fileId } = await params
    const url = new URL(request.url)
    const providedPassword = url.searchParams.get('password')

    // Find the file
    const file = await prisma.file.findUnique({
      where: { id: fileId },
      select: {
        id: true,
        name: true,
        path: true,
        mimeType: true,
        size: true,
        userId: true,
        visibility: true,
        password: true,
      },
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

    // Increment download count
    await prisma.file.update({
      where: { id: fileId },
      data: { downloads: { increment: 1 } },
    })

    const storageProvider = await getStorageProvider()
    const range = request.headers.get('range')
    const size = await storageProvider.getFileSize(file.path)

    // Handle range requests
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
        'Content-Disposition': `attachment; filename=${encodeFilename(file.name)}`,
      }

      return new NextResponse(stream as unknown as ReadableStream, {
        status: 206,
        headers,
      })
    }

    // No range requested - serve full file
    const stream = await storageProvider.getFileStream(file.path)
    const headers = {
      'Content-Type': file.mimeType,
      'Content-Disposition': `attachment; filename=${encodeFilename(file.name)}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': size.toString(),
    }

    return new NextResponse(stream as unknown as ReadableStream, { headers })
  } catch (error) {
    console.error('File download error:', error)
    return new Response(null, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    const { id: fileId } = await params

    // Get password from request body for POST requests
    let providedPassword: string | null = null
    try {
      const body = await request.json()
      providedPassword = body.password || null
    } catch {
      // If no JSON body, that's fine - password might not be needed
    }

    // Find the file
    const file = await prisma.file.findUnique({
      where: { id: fileId },
      select: {
        id: true,
        name: true,
        path: true,
        mimeType: true,
        size: true,
        userId: true,
        visibility: true,
        password: true,
      },
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

    // Increment download count
    await prisma.file.update({
      where: { id: fileId },
      data: { downloads: { increment: 1 } },
    })

    const storageProvider = await getStorageProvider()
    const size = await storageProvider.getFileSize(file.path)

    // Serve full file for POST requests
    const stream = await storageProvider.getFileStream(file.path)
    const headers = {
      'Content-Type': file.mimeType,
      'Content-Disposition': `attachment; filename=${encodeFilename(file.name)}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': size.toString(),
    }

    return new NextResponse(stream as unknown as ReadableStream, { headers })
  } catch (error) {
    console.error('File download error:', error)
    return new Response(null, { status: 500 })
  }
}
