import { Prisma } from '@prisma/client'

import { HTTP_STATUS, apiError, apiResponse } from '@/lib/api/response'
import { requireAuth } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'
import { buildFolderTree } from '@/lib/folders/tree'
import { loggers } from '@/lib/logger'
import { isOrganizationEnabled } from '@/lib/organization'

import { CreateFolderSchema } from '@/types/dto/folder'
import type { FolderDTO } from '@/types/dto/folder'

const logger = loggers.files

export const runtime = 'nodejs'

async function getUserFolderDTOs(userId: string): Promise<FolderDTO[]> {
  const folders = await prisma.folder.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      color: true,
      parentId: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { files: true } },
    },
  })

  return folders.map((folder) => ({
    id: folder.id,
    name: folder.name,
    color: folder.color,
    parentId: folder.parentId,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
    fileCount: folder._count.files,
  }))
}

export async function GET(req: Request) {
  try {
    if (!(await isOrganizationEnabled())) {
      return apiError('Organization is disabled', HTTP_STATUS.NOT_FOUND)
    }

    const { user, response } = await requireAuth(req)
    if (response) return response

    const folders = await getUserFolderDTOs(user.id)
    const tree = buildFolderTree(folders)

    return apiResponse({ folders, tree })
  } catch (error) {
    logger.error('Error fetching folders', error as Error)
    return apiError(
      'Failed to fetch folders',
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    )
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
    const parsed = CreateFolderSchema.safeParse(body)
    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message || 'Invalid request body',
        HTTP_STATUS.BAD_REQUEST
      )
    }

    const { name, parentId, color } = parsed.data

    if (parentId) {
      const parent = await prisma.folder.findFirst({
        where: { id: parentId, userId: user.id },
        select: { id: true },
      })
      if (!parent) {
        return apiError('Parent folder not found', HTTP_STATUS.NOT_FOUND)
      }
    }

    try {
      const folder = await prisma.folder.create({
        data: {
          name,
          parentId: parentId ?? null,
          color: color ?? null,
          userId: user.id,
        },
        select: {
          id: true,
          name: true,
          color: true,
          parentId: true,
          createdAt: true,
          updatedAt: true,
        },
      })

      return apiResponse<FolderDTO>({ ...folder, fileCount: 0 })
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return apiError(
          'A folder with this name already exists here',
          HTTP_STATUS.CONFLICT
        )
      }
      throw error
    }
  } catch (error) {
    logger.error('Error creating folder', error as Error)
    return apiError(
      'Failed to create folder',
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    )
  }
}
