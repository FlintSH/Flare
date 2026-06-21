import { CreateTagSchema } from '@/types/dto/tag'
import type { TagDTO } from '@/types/dto/tag'
import { Prisma } from '@prisma/client'

import { HTTP_STATUS, apiError, apiResponse } from '@/lib/api/response'
import { requireAuth } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { isOrganizationEnabled } from '@/lib/organization'
import { normalizeTagName } from '@/lib/tags/normalize'

const logger = loggers.files

export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    if (!(await isOrganizationEnabled())) {
      return apiError('Organization is disabled', HTTP_STATUS.NOT_FOUND)
    }

    const { user, response } = await requireAuth(req)
    if (response) return response

    const tags = await prisma.tag.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        name: true,
        color: true,
        createdAt: true,
        _count: { select: { files: true } },
      },
      orderBy: { name: 'asc' },
    })

    const dtos: TagDTO[] = tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color,
      createdAt: tag.createdAt,
      fileCount: tag._count.files,
    }))

    return apiResponse({ tags: dtos })
  } catch (error) {
    logger.error('Error fetching tags', error as Error)
    return apiError('Failed to fetch tags', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}

export async function POST(req: Request) {
  try {
    if (!(await isOrganizationEnabled())) {
      return apiError('Organization is disabled', HTTP_STATUS.NOT_FOUND)
    }

    const { user, response } = await requireAuth(req)
    if (response) return response

    const body = await req.json()
    const parsed = CreateTagSchema.safeParse(body)
    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message || 'Invalid request body',
        HTTP_STATUS.BAD_REQUEST
      )
    }

    const name = normalizeTagName(parsed.data.name)
    if (!name) {
      return apiError('Tag name is required', HTTP_STATUS.BAD_REQUEST)
    }

    // Case-insensitive duplicate detection so "Design" and "design" don't both
    // exist for the same user.
    const existing = await prisma.tag.findFirst({
      where: { userId: user.id, name: { equals: name, mode: 'insensitive' } },
      select: {
        id: true,
        name: true,
        color: true,
        createdAt: true,
        _count: { select: { files: true } },
      },
    })
    if (existing) {
      // Idempotent create: return the existing tag so "create on the fly" flows
      // never error on a tag the user already has.
      return apiResponse<TagDTO>({
        id: existing.id,
        name: existing.name,
        color: existing.color,
        createdAt: existing.createdAt,
        fileCount: existing._count.files,
      })
    }

    try {
      const tag = await prisma.tag.create({
        data: {
          name,
          color: parsed.data.color ?? null,
          userId: user.id,
        },
        select: { id: true, name: true, color: true, createdAt: true },
      })
      return apiResponse<TagDTO>({ ...tag, fileCount: 0 })
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return apiError(
          'A tag with this name already exists',
          HTTP_STATUS.CONFLICT
        )
      }
      throw error
    }
  } catch (error) {
    logger.error('Error creating tag', error as Error)
    return apiError('Failed to create tag', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}
