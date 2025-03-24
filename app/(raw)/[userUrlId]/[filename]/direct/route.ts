import { NextResponse } from 'next/server'

import { compare } from 'bcryptjs'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { S3StorageProvider, getStorageProvider } from '@/lib/storage'

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

    const isVideo = file.mimeType.startsWith('video/')
    if (!isVideo) {
      return new Response(null, { status: 400, statusText: 'Not a video file' })
    }

    const storageProvider = await getStorageProvider()

    if (!(storageProvider instanceof S3StorageProvider)) {
      const rawUrl = `${urlPath}/raw${providedPassword ? `?password=${providedPassword}` : ''}`
      return NextResponse.json({ url: rawUrl })
    }

    const directUrl = await storageProvider.getFileUrl(file.path)

    return NextResponse.json({ url: directUrl })
  } catch (error) {
    console.error('Direct URL error:', error)
    return new Response(null, { status: 500 })
  }
}
