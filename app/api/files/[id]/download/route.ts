import { NextRequest, NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { checkFileAccess } from '@/lib/files/access'
import { loggers } from '@/lib/logger'
import { sanitizeDisplayName } from '@/lib/security/paths'
import { getStorageProvider } from '@/lib/storage'

const logger = loggers.files

function encodeFilename(filename: string): string {
  const safe = sanitizeDisplayName(filename)
  const encoded = encodeURIComponent(safe)
  return `"${encoded.replace(/["\\]/g, '\\$&')}"; filename*=UTF-8''${encoded}`
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

    const access = await checkFileAccess(file, session, providedPassword)
    if (!access.allowed) {
      return new Response(null, { status: access.status })
    }

    await prisma.file.update({
      where: { id: fileId },
      data: { downloads: { increment: 1 } },
    })

    const storageProvider = await getStorageProvider()

    if ('getDownloadUrl' in storageProvider && storageProvider.getDownloadUrl) {
      const downloadUrl = await storageProvider.getDownloadUrl(
        file.path,
        file.name
      )
      return Response.redirect(downloadUrl, 302)
    }

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
        'X-Content-Type-Options': 'nosniff',
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
      'X-Content-Type-Options': 'nosniff',
    }

    return new NextResponse(stream as unknown as ReadableStream, { headers })
  } catch (error) {
    logger.error('File download error', error as Error)
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

    const access = await checkFileAccess(file, session, providedPassword)
    if (!access.allowed) {
      return new Response(null, { status: access.status })
    }

    await prisma.file.update({
      where: { id: fileId },
      data: { downloads: { increment: 1 } },
    })

    const storageProvider = await getStorageProvider()

    if ('getDownloadUrl' in storageProvider && storageProvider.getDownloadUrl) {
      const downloadUrl = await storageProvider.getDownloadUrl(
        file.path,
        file.name
      )
      return Response.redirect(downloadUrl, 302)
    }

    const size = await storageProvider.getFileSize(file.path)

    const stream = await storageProvider.getFileStream(file.path)
    const headers = {
      'Content-Type': file.mimeType,
      'Content-Disposition': `attachment; filename=${encodeFilename(file.name)}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': size.toString(),
      'X-Content-Type-Options': 'nosniff',
    }

    return new NextResponse(stream as unknown as ReadableStream, { headers })
  } catch (error) {
    logger.error('File download error', error as Error)
    return new Response(null, { status: 500 })
  }
}
