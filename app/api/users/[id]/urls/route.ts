import { prisma } from '@/lib/database/prisma'
import { requireSession } from '@/lib/http/access'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/users/[id]/urls', {
  failure: { message: 'Internal Server Error' },
  logger: loggers.users,
})

export const GET = api(async (request, { params }: Context) => {
  await requireSession('content.read')
  const { id } = await params

  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '10')
  const search = searchParams.get('search') || ''

  const skip = (page - 1) * limit

  const where = {
    userId: id,
    ...(search
      ? {
          OR: [
            {
              shortCode: {
                contains: search,
                mode: 'insensitive' as const,
              },
            },
            {
              targetUrl: {
                contains: search,
                mode: 'insensitive' as const,
              },
            },
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

  return {
    urls,
    pagination: {
      total,
      pages: Math.ceil(total / limit),
      page,
      limit,
    },
  }
})
