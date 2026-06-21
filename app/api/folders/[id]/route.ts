import { Prisma } from '@prisma/client'

import { HTTP_STATUS, apiError, apiResponse } from '@/lib/api/response'
import { requireAuth } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'
import { getBreadcrumb, wouldCreateCycle } from '@/lib/folders/tree'
import { loggers } from '@/lib/logger'
import { isOrganizationEnabled } from '@/lib/organization'

import { UpdateFolderSchema } from '@/types/dto/folder'
import type { FolderDTO } from '@/types/dto/folder'

const logger = loggers.files

export const runtime = 'nodejs'

export async function GET(
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

    const folder = await prisma.folder.findFirst({
      where: { id, userId: user.id },
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

    if (!folder) {
      return apiError('Folder not found', HTTP_STATUS.NOT_FOUND)
    }

    const allFolders = await prisma.folder.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, parentId: true },
    })

    const children = await prisma.folder.findMany({
      where: { userId: user.id, parentId: id },
      select: {
        id: true,
        name: true,
        color: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { files: true } },
      },
      orderBy: { name: 'asc' },
    })

    const dto: FolderDTO = {
      id: folder.id,
      name: folder.name,
      color: folder.color,
      parentId: folder.parentId,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
      fileCount: folder._count.files,
    }

    return apiResponse({
      folder: dto,
      breadcrumb: getBreadcrumb(allFolders, id),
      children: children.map((child) => ({
        id: child.id,
        name: child.name,
        color: child.color,
        parentId: child.parentId,
        createdAt: child.createdAt,
        updatedAt: child.updatedAt,
        fileCount: child._count.files,
      })),
    })
  } catch (error) {
    logger.error('Error fetching folder', error as Error)
    return apiError('Failed to fetch folder', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}

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
    const parsed = UpdateFolderSchema.safeParse(body)
    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message || 'Invalid request body',
        HTTP_STATUS.BAD_REQUEST
      )
    }

    const existing = await prisma.folder.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    })
    if (!existing) {
      return apiError('Folder not found', HTTP_STATUS.NOT_FOUND)
    }

    const { name, parentId, color } = parsed.data

    if (parentId !== undefined && parentId !== null) {
      const parent = await prisma.folder.findFirst({
        where: { id: parentId, userId: user.id },
        select: { id: true },
      })
      if (!parent) {
        return apiError('Parent folder not found', HTTP_STATUS.NOT_FOUND)
      }
    }

    if (parentId !== undefined) {
      const allFolders = await prisma.folder.findMany({
        where: { userId: user.id },
        select: { id: true, parentId: true },
      })
      if (wouldCreateCycle(allFolders, id, parentId)) {
        return apiError(
          'Cannot move a folder into itself or one of its subfolders',
          HTTP_STATUS.BAD_REQUEST
        )
      }
    }

    const data: Prisma.FolderUpdateInput = {}
    if (name !== undefined) data.name = name
    if (color !== undefined) data.color = color
    if (parentId !== undefined) {
      data.parent = parentId
        ? { connect: { id: parentId } }
        : { disconnect: true }
    }

    try {
      const folder = await prisma.folder.update({
        where: { id },
        data,
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

      return apiResponse<FolderDTO>({
        id: folder.id,
        name: folder.name,
        color: folder.color,
        parentId: folder.parentId,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
        fileCount: folder._count.files,
      })
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
    logger.error('Error updating folder', error as Error)
    return apiError(
      'Failed to update folder',
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    )
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

    const folder = await prisma.folder.findFirst({
      where: { id, userId: user.id },
      select: { id: true, parentId: true },
    })
    if (!folder) {
      return apiError('Folder not found', HTTP_STATUS.NOT_FOUND)
    }

    // Safe delete: reparent direct child folders and contained files up to this
    // folder's parent (or root), then delete the now-empty folder. Files are
    // never deleted by removing a folder.
    await prisma.$transaction([
      prisma.folder.updateMany({
        where: { parentId: id, userId: user.id },
        data: { parentId: folder.parentId },
      }),
      prisma.file.updateMany({
        where: { folderId: id, userId: user.id },
        data: { folderId: folder.parentId },
      }),
      prisma.folder.delete({ where: { id } }),
    ])

    return apiResponse({ success: true, reparentedTo: folder.parentId })
  } catch (error) {
    logger.error('Error deleting folder', error as Error)
    return apiError(
      'Failed to delete folder',
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    )
  }
}
