import { UpdateTagSchema } from '@/types/dto/tag'
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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await isOrganizationEnabled())) {
      return apiError('Organization is disabled', HTTP_STATUS.NOT_FOUND)
    }

    const { user, response } = await requireAuth(req)
    if (response) return response

    const { id } = await params
    const body = await req.json()
    const parsed = UpdateTagSchema.safeParse(body)
    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message || 'Invalid request body',
        HTTP_STATUS.BAD_REQUEST
      )
    }

    const existing = await prisma.tag.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    })
    if (!existing) {
      return apiError('Tag not found', HTTP_STATUS.NOT_FOUND)
    }

    const data: Prisma.TagUpdateInput = {}
    if (parsed.data.name !== undefined) {
      const name = normalizeTagName(parsed.data.name)
      if (!name) {
        return apiError('Tag name is required', HTTP_STATUS.BAD_REQUEST)
      }
      data.name = name
    }
    if (parsed.data.color !== undefined) {
      data.color = parsed.data.color
    }

    try {
      const tag = await prisma.tag.update({
        where: { id },
        data,
        select: {
          id: true,
          name: true,
          color: true,
          createdAt: true,
          _count: { select: { files: true } },
        },
      })
      return apiResponse<TagDTO>({
        id: tag.id,
        name: tag.name,
        color: tag.color,
        createdAt: tag.createdAt,
        fileCount: tag._count.files,
      })
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
    logger.error('Error updating tag', error as Error)
    return apiError('Failed to update tag', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await isOrganizationEnabled())) {
      return apiError('Organization is disabled', HTTP_STATUS.NOT_FOUND)
    }

    const { user, response } = await requireAuth(req)
    if (response) return response

    const { id } = await params

    const existing = await prisma.tag.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    })
    if (!existing) {
      return apiError('Tag not found', HTTP_STATUS.NOT_FOUND)
    }

    // FileTag rows cascade away; the files themselves are untouched.
    await prisma.tag.delete({ where: { id } })

    return apiResponse({ success: true })
  } catch (error) {
    logger.error('Error deleting tag', error as Error)
    return apiError('Failed to delete tag', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}
