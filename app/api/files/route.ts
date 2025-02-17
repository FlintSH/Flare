import { NextResponse } from 'next/server'

import { Prisma } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { join } from 'path'
import { z } from 'zod'

import { authOptions } from '@/lib/auth'
import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { getUniqueFilename } from '@/lib/files/filename'
import { processImageOCR } from '@/lib/ocr'
import { getStorageProvider } from '@/lib/storage'
import { bytesToMB } from '@/lib/utils'

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

export async function POST(req: Request) {
  let filePath = ''

  try {
    const user = await getAuthenticatedUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await req.formData()
    const uploadedFile = formData.get('file') as File
    const visibility =
      (formData.get('visibility') as 'PUBLIC' | 'PRIVATE') || 'PUBLIC'
    const password = formData.get('password') as string | null

    if (!uploadedFile) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Get config to check max upload size and quotas
    const config = await getConfig()
    const maxSize = config.settings.general.storage.maxUploadSize
    const maxBytes =
      maxSize.value * (maxSize.unit === 'GB' ? 1024 * 1024 * 1024 : 1024 * 1024)
    const quotasEnabled = config.settings.general.storage.quotas.enabled
    const defaultQuota = config.settings.general.storage.quotas.default

    if (uploadedFile.size > maxBytes) {
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
      const fileSizeMB = bytesToMB(uploadedFile.size)

      if (user.storageUsed + fileSizeMB > quotaMB) {
        return NextResponse.json(
          {
            error: `You have reached your storage quota of ${defaultQuota.value}${defaultQuota.unit}`,
          },
          { status: 413 }
        )
      }
    }

    // Get unique filename
    const { urlSafeName, displayName } = await getUniqueFilename(
      join('uploads', user.urlId),
      uploadedFile.name
    )

    // Construct paths
    filePath = join('uploads', user.urlId, urlSafeName)
    const urlPath = `/${user.urlId}/${urlSafeName}`

    // Get storage provider and upload file
    const storageProvider = await getStorageProvider()
    const bytes = await uploadedFile.arrayBuffer()
    await storageProvider.uploadFile(
      Buffer.from(bytes),
      filePath,
      uploadedFile.type
    )

    // Create database record and update storage usage in a transaction
    const fileRecord = await prisma.$transaction(async (tx) => {
      const file = await tx.file.create({
        data: {
          name: displayName,
          urlPath,
          mimeType: uploadedFile.type,
          size: bytesToMB(uploadedFile.size),
          path: filePath,
          visibility: visibility,
          password: password,
          userId: user.id,
        },
      })

      await tx.user.update({
        where: { id: user.id },
        data: {
          storageUsed: {
            increment: bytesToMB(uploadedFile.size),
          },
        },
      })

      return file
    })

    // If it's an image, trigger OCR processing in the background
    if (uploadedFile.type.startsWith('image/')) {
      processImageOCR(filePath, fileRecord.id).catch((error) => {
        console.error('Background OCR processing failed:', error)
      })
    }

    return NextResponse.json({
      url: `${process.env.NEXTAUTH_URL}${urlPath}`,
      name: displayName,
      size: uploadedFile.size,
      type: uploadedFile.type,
    })
  } catch (error) {
    console.error('Upload error:', error)

    // Clean up the file if it was created
    if (filePath) {
      try {
        const storageProvider = await getStorageProvider()
        await storageProvider.deleteFile(filePath)
        console.log('Cleaned up file after error:', filePath)
      } catch (unlinkError) {
        console.error('Failed to clean up file:', unlinkError)
      }
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Invalid metadata format',
        },
        { status: 400 }
      )
    }

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

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // parse pagination params from URL
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '24')
    const search = searchParams.get('search') || ''
    const sortBy = searchParams.get('sortBy') || 'newest'
    const types = searchParams.get('types')?.split(',') || []
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const visibilityFilters = searchParams.get('visibility')?.split(',') || []
    const offset = (page - 1) * limit

    // Build where clause for filtering
    const where: Prisma.FileWhereInput = {
      userId: session.user.id,
    }

    const conditions: Prisma.FileWhereInput[] = []

    if (search) {
      conditions.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { ocrText: { contains: search, mode: 'insensitive' } },
        ],
      })
    }

    if (types.length > 0) {
      conditions.push({ mimeType: { in: types } })
    }

    if (dateFrom || dateTo) {
      const dateFilter: Prisma.DateTimeFilter = {}
      if (dateFrom) {
        const startDate = new Date(dateFrom)
        dateFilter.gte = startDate

        // If dateTo is not provided, use the same date as end date
        const endDate = dateTo ? new Date(dateTo) : new Date(dateFrom)
        endDate.setHours(23, 59, 59, 999)
        dateFilter.lte = endDate
      }
      conditions.push({ uploadedAt: dateFilter })
    }

    if (visibilityFilters.length > 0) {
      const visibilityConditions = []

      for (const filter of visibilityFilters) {
        if (filter === 'hasPassword') {
          visibilityConditions.push({ password: { not: null } })
        } else {
          // Convert visibility filter to uppercase to match Prisma enum
          visibilityConditions.push({
            visibility: filter.toUpperCase() as 'PUBLIC' | 'PRIVATE',
          })
        }
      }

      conditions.push({ OR: visibilityConditions })
    }

    // Add conditions to where clause if any exist
    if (conditions.length > 0) {
      where.AND = conditions
    }

    // Build orderBy based on sortBy parameter
    const orderBy: Prisma.FileOrderByWithRelationInput = {}
    switch (sortBy) {
      case 'oldest':
        orderBy.uploadedAt = 'asc'
        break
      case 'largest':
        orderBy.size = 'desc'
        break
      case 'smallest':
        orderBy.size = 'asc'
        break
      case 'name':
        orderBy.name = 'asc'
        break
      default: // "newest"
        orderBy.uploadedAt = 'desc'
    }

    // Get total count for pagination
    const total = await prisma.file.count({ where })

    // Get files with pagination
    const files = await prisma.file.findMany({
      where,
      orderBy,
      take: limit,
      skip: offset,
      select: {
        id: true,
        name: true,
        urlPath: true,
        mimeType: true,
        size: true,
        uploadedAt: true,
        visibility: true,
        password: true,
        user: {
          select: {
            urlId: true,
          },
        },
      },
    })

    const responseData = {
      files,
      pagination: {
        total,
        pageCount: Math.ceil(total / limit),
        page,
        limit,
      },
    }

    return NextResponse.json(responseData)
  } catch (error) {
    const err = error as Error
    console.error('Error fetching files:', {
      name: err.name,
      message: err.message,
      stack: err.stack,
      cause: err.cause,
    })

    return NextResponse.json(
      { error: 'Failed to fetch files' },
      { status: 500 }
    )
  }
}
