import { NextRequest, NextResponse } from 'next/server'

import { compare } from 'bcryptjs'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { getStorageProvider } from '@/lib/storage'

function encodeFilename(filename: string): string {
  const encoded = encodeURIComponent(filename)
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

    const isOwner = session?.user?.id === file.userId
    const isPrivate = file.visibility === 'PRIVATE' && !isOwner

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

    await prisma.file.update({
      where: { id: fileId },
      data: { downloads: { increment: 1 } },
    })

    const storageProvider = await getStorageProvider()

    // For S3 storage, use direct presigned URLs for better reliability
    if ('getDownloadUrl' in storageProvider && storageProvider.getDownloadUrl) {
      const downloadUrl = await storageProvider.getDownloadUrl(
        file.path,
        file.name
      )
      return Response.redirect(downloadUrl, 302)
    }

    // Fallback to proxied download for local storage or S3 without getDownloadUrl
    const range = request.headers.get('range')
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
        'Content-Disposition': `attachment; filename=${encodeFilename(file.name)}`,
      }

      return new NextResponse(stream as unknown as ReadableStream, {
        status: 206,
        headers,
      })
    }

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

    let providedPassword: string | null = null
    try {
      const body = await request.json()
      providedPassword = body.password || null
    } catch {}

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

    const isOwner = session?.user?.id === file.userId
    const isPrivate = file.visibility === 'PRIVATE' && !isOwner

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

    await prisma.file.update({
      where: { id: fileId },
      data: { downloads: { increment: 1 } },
    })

    const storageProvider = await getStorageProvider()

    // For S3 storage, use direct presigned URLs for better reliability
    if ('getDownloadUrl' in storageProvider && storageProvider.getDownloadUrl) {
      const downloadUrl = await storageProvider.getDownloadUrl(
        file.path,
        file.name
      )
      return Response.redirect(downloadUrl, 302)
    }

    // Fallback to proxied download for local storage or S3 without getDownloadUrl
    const size = await storageProvider.getFileSize(file.path)

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
