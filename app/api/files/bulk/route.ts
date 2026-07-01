import { BulkFileActionSchema } from '@/types/dto/file'

import { HTTP_STATUS, apiError, apiResponse } from '@/lib/api/response'
import { requireAuth } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { isOrganizationEnabled } from '@/lib/organization'
import { getStorageProvider } from '@/lib/storage'

const logger = loggers.files

export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    const { user, response } = await requireAuth(req)
    if (response) return response

    const body = await req.json()
    const parsed = BulkFileActionSchema.safeParse(body)
    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message || 'Invalid request body',
        HTTP_STATUS.BAD_REQUEST
      )
    }

    const { fileIds, action, folderId, tagIds } = parsed.data

    // Tag/folder actions require organization to be enabled. Delete is always
    // allowed (it's a core file operation).
    if (action !== 'delete' && !(await isOrganizationEnabled())) {
      return apiError('Organization is disabled', HTTP_STATUS.NOT_FOUND)
    }

    // Only operate on files the user actually owns.
    const ownedFiles = await prisma.file.findMany({
      where: { id: { in: fileIds }, userId: user.id },
      select: { id: true, path: true, size: true },
    })
    const ownedIds = ownedFiles.map((f) => f.id)

    if (ownedIds.length === 0) {
      return apiResponse({ affected: 0 })
    }

    if (action === 'move') {
      if (folderId) {
        const folder = await prisma.folder.findFirst({
          where: { id: folderId, userId: user.id },
          select: { id: true },
        })
        if (!folder) {
          return apiError('Folder not found', HTTP_STATUS.NOT_FOUND)
        }
      }
      await prisma.file.updateMany({
        where: { id: { in: ownedIds } },
        data: { folderId: folderId ?? null },
      })
      return apiResponse({ affected: ownedIds.length })
    }

    if (action === 'addTags') {
      const owned = await prisma.tag.findMany({
        where: { id: { in: tagIds ?? [] }, userId: user.id },
        select: { id: true },
      })
      const validTagIds = owned.map((t) => t.id)
      if (validTagIds.length > 0) {
        await prisma.fileTag.createMany({
          data: ownedIds.flatMap((fileId) =>
            validTagIds.map((tagId) => ({ fileId, tagId }))
          ),
          skipDuplicates: true,
        })
      }
      return apiResponse({ affected: ownedIds.length })
    }

    if (action === 'removeTags') {
      await prisma.fileTag.deleteMany({
        where: { fileId: { in: ownedIds }, tagId: { in: tagIds ?? [] } },
      })
      return apiResponse({ affected: ownedIds.length })
    }

    // action === 'delete'
    const storageProvider = await getStorageProvider()
    await Promise.all(
      ownedFiles.map(async (file) => {
        try {
          await storageProvider.deleteFile(file.path)
        } catch (error) {
          logger.error('Error deleting file from storage', error as Error, {
            fileId: file.id,
            filePath: file.path,
          })
        }
      })
    )

    const totalSizeMB = ownedFiles.reduce((sum, f) => sum + f.size, 0)

    await prisma.$transaction([
      prisma.file.deleteMany({ where: { id: { in: ownedIds } } }),
      prisma.user.update({
        where: { id: user.id },
        data: { storageUsed: { decrement: totalSizeMB } },
      }),
    ])

    return apiResponse({ affected: ownedIds.length })
  } catch (error) {
    logger.error('Bulk file action error', error as Error)
    return apiError(
      'Failed to perform bulk action',
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    )
  }
}
