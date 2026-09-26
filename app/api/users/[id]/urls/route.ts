import { NextResponse } from 'next/server'

import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { requirePermission } from '@/lib/permissions/server'

const logger = loggers.users

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { session, response: permissionDenied } =
      await requirePermission('content.read')
    if (permissionDenied) return permissionDenied
    const { id } = await params

    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const search = searchParams.get('search') || ''

    const skip = (page - 1) * limit

    const where = {
      userId: id,
      ...(search
        ? {
            OR: [
              { shortCode: { contains: search, mode: 'insensitive' as const } },
              { targetUrl: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    }

    const total = await prisma.shortenedUrl.count({ where })

    const urls = await prisma.shortenedUrl.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        shortCode: true,
        targetUrl: true,
        clicks: true,
        createdAt: true,
      },
    })

    return NextResponse.json({
      urls,
      pagination: {
        total,
        pages: Math.ceil(total / limit),
        page,
        limit,
      },
    })
  } catch (error) {
    logger.error('Error fetching user URLs:', error as Error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
