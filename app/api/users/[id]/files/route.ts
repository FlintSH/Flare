import { NextResponse } from 'next/server'

import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { requirePermission } from '@/lib/permissions/server'

const logger = loggers.files

type FileVisibility = 'PUBLIC' | 'PRIVATE'

interface FileData {
  id: string
  name: string
  mimeType: string
  size: number
  visibility: FileVisibility
  uploadedAt: Date
  urlPath: string
  isPaste: boolean
  password: string | null
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, response: permissionDenied } =
    await requirePermission('content.read')
  if (permissionDenied) return permissionDenied

  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  try {
    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const search = searchParams.get('search') || ''
    const visibility = searchParams.get('visibility') as FileVisibility | null
    const type = searchParams.get('type') || ''

    const skip = (page - 1) * limit

    const { id } = await params

    const where = {
      userId: id,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { ocrText: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(visibility ? { visibility } : {}),
      ...(type ? { mimeType: { startsWith: type } } : {}),
    }

    const total = await prisma.file.count({ where })

    const files = await prisma.file.findMany({
      where,
      orderBy: { uploadedAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        mimeType: true,
        size: true,
        visibility: true,
        uploadedAt: true,
        urlPath: true,
        isPaste: true,
        password: true,
      },
    })

    const transformedFiles = files.map(({ password, ...file }: FileData) => ({
      ...file,
      visibility: password ? 'PROTECTED' : file.visibility,
    }))

    return NextResponse.json({
      files: transformedFiles,
      pagination: {
        total,
        pages: Math.ceil(total / limit),
        page,
        limit,
      },
    })
  } catch (error) {
    logger.error('Error fetching user files:', error as Error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
