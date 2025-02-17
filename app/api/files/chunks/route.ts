import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'
import type { Writable as NodeWritable } from 'node:stream'
import { join } from 'path'

import { authOptions } from '@/lib/auth'
import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { getUniqueFilename } from '@/lib/files/filename'
import { processImageOCR } from '@/lib/ocr'
import { getStorageProvider } from '@/lib/storage'
import { bytesToMB } from '@/lib/utils'

// Store chunk metadata in memory (could be moved to Redis/DB for production)
const chunkMap = new Map<
  string,
  {
    receivedChunks: number
    totalChunks: number
    filename: string
    mimeType: string
    totalSize: number
    userId: string
    visibility: 'PUBLIC' | 'PRIVATE'
    password: string | null
    writeStream: NodeWritable
    filePath?: string
    urlPath?: string
  }
>()

// Clean up chunks older than 24 hours
setInterval(
  () => {
    const now = Date.now()
    for (const [uploadId, metadata] of chunkMap.entries()) {
      if (now - parseInt(uploadId.split('-')[1]) > 24 * 60 * 60 * 1000) {
        // Destroy write stream if it exists
        metadata.writeStream.destroy()
        chunkMap.delete(uploadId)
      }
    }
  },
  60 * 60 * 1000
) // Check every hour

export async function POST(req: Request) {
  try {
    const user = await getAuthenticatedUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await req.formData()
    const uploadId = formData.get('uploadId') as string
    const chunkNumber = parseInt(formData.get('chunkNumber') as string)
    const totalChunks = parseInt(formData.get('totalChunks') as string)
    const chunkData = formData.get('chunk') as File
    const filename = formData.get('filename') as string
    const mimeType = formData.get('mimeType') as string
    const totalSize = parseInt(formData.get('totalSize') as string)
    const visibility =
      (formData.get('visibility') as 'PUBLIC' | 'PRIVATE') || 'PUBLIC'
    const password = formData.get('password') as string | null

    if (
      !uploadId ||
      chunkNumber === undefined ||
      isNaN(chunkNumber) ||
      totalChunks === undefined ||
      isNaN(totalChunks) ||
      !chunkData ||
      !filename ||
      totalSize === undefined ||
      isNaN(totalSize)
    ) {
      const missingFields = [
        !uploadId && 'uploadId',
        (chunkNumber === undefined || isNaN(chunkNumber)) && 'chunkNumber',
        (totalChunks === undefined || isNaN(totalChunks)) && 'totalChunks',
        !chunkData && 'chunk',
        !filename && 'filename',
        (totalSize === undefined || isNaN(totalSize)) && 'totalSize',
      ].filter(Boolean)

      return NextResponse.json(
        {
          error: `Missing required fields: ${missingFields.join(', ')}`,
        },
        { status: 400 }
      )
    }

    // Get config to check max upload size and quotas
    const config = await getConfig()
    const maxSize = config.settings.general.storage.maxUploadSize
    const maxBytes =
      maxSize.value * (maxSize.unit === 'GB' ? 1024 * 1024 * 1024 : 1024 * 1024)
    const quotasEnabled = config.settings.general.storage.quotas.enabled
    const defaultQuota = config.settings.general.storage.quotas.default

    // Validate total size
    if (totalSize > maxBytes) {
      return NextResponse.json(
        {
          error: `Maximum file size is ${maxSize.value}${maxSize.unit}`,
        },
        { status: 413 }
      )
    }

    // Check quota if enabled (skip for admins)
    if (quotasEnabled && user.role !== 'ADMIN') {
      const quotaMB =
        defaultQuota.value * (defaultQuota.unit === 'GB' ? 1024 : 1)
      const fileSizeMB = bytesToMB(totalSize)

      if (user.storageUsed + fileSizeMB > quotaMB) {
        return NextResponse.json(
          {
            error: `You have reached your storage quota of ${defaultQuota.value}${defaultQuota.unit}`,
          },
          { status: 413 }
        )
      }
    }

    // Initialize streaming upload if this is the first chunk
    if (!chunkMap.has(uploadId)) {
      // Get unique filename and paths
      const { urlSafeName, displayName } = await getUniqueFilename(
        join('uploads', user.urlId),
        filename
      )

      const filePath = join('uploads', user.urlId, urlSafeName)
      const urlPath = `/${user.urlId}/${urlSafeName}`

      // Initialize the write stream
      const storageProvider = await getStorageProvider()
      const writeStream = await storageProvider.createWriteStream(
        filePath,
        mimeType
      )

      chunkMap.set(uploadId, {
        receivedChunks: 0,
        totalChunks,
        filename: displayName,
        mimeType,
        totalSize,
        userId: user.id,
        visibility,
        password,
        writeStream,
        filePath,
        urlPath,
      })
    }

    const metadata = chunkMap.get(uploadId)!

    // Stream the chunk data
    const chunkBuffer = Buffer.from(await chunkData.arrayBuffer())
    await new Promise<void>((resolve, reject) => {
      metadata.writeStream.write(chunkBuffer, (error?: Error | null) => {
        if (error) reject(error)
        else resolve()
      })
    })

    metadata.receivedChunks++

    // Check if all chunks are uploaded
    if (metadata.receivedChunks === metadata.totalChunks) {
      // Close the write stream
      await new Promise<void>((resolve, reject) => {
        metadata.writeStream.end((error?: Error | null) => {
          if (error) reject(error)
          else resolve()
        })
      })

      // Create database record and update storage usage in a transaction
      const fileRecord = await prisma.$transaction(async (tx) => {
        const file = await tx.file.create({
          data: {
            name: metadata.filename,
            urlPath: metadata.urlPath!,
            mimeType: metadata.mimeType,
            size: bytesToMB(metadata.totalSize),
            path: metadata.filePath!,
            visibility: metadata.visibility,
            password: metadata.password,
            userId: metadata.userId,
          },
        })

        await tx.user.update({
          where: { id: metadata.userId },
          data: {
            storageUsed: {
              increment: bytesToMB(metadata.totalSize),
            },
          },
        })

        return file
      })

      // If it's an image, trigger OCR processing in the background
      if (metadata.mimeType.startsWith('image/')) {
        processImageOCR(metadata.filePath!, fileRecord.id).catch(
          (error: Error) => {
            console.error('Background OCR processing failed:', error)
          }
        )
      }

      chunkMap.delete(uploadId)

      return NextResponse.json({
        url: `${process.env.NEXTAUTH_URL}${metadata.urlPath}`,
        name: metadata.filename,
        size: metadata.totalSize,
        type: metadata.mimeType,
        status: 'complete',
      })
    }

    // Return progress
    return NextResponse.json({
      status: 'progress',
      chunksReceived: metadata.receivedChunks,
      totalChunks: metadata.totalChunks,
    })
  } catch (error) {
    console.error('Chunk upload error:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'An unexpected error occurred',
      },
      { status: 500 }
    )
  }
}

// Helper function to get user from either session or upload token
async function getAuthenticatedUser(req: Request) {
  // First try session auth
  const session = await getServerSession(authOptions)
  if (session?.user) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, storageUsed: true, urlId: true, role: true },
    })
    return user
  }

  // Then try token auth
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7)
    const user = await prisma.user.findUnique({
      where: { uploadToken: token },
      select: { id: true, storageUsed: true, urlId: true, role: true },
    })
    return user
  }

  return null
}
