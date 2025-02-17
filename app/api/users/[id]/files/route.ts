import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'

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
  const session = await getServerSession(authOptions)

  if (!session?.user || session.user.role !== 'ADMIN') {
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

    // Get the user ID from params after awaiting
    const { id } = await params

    // Build where clause based on filters
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

    // Get total count for pagination
    const total = await prisma.file.count({ where })

    // Get paginated files
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

    // show protected as visibility when password exists
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
    console.error('Error fetching user files:', error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
