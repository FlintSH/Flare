import { hash } from 'bcryptjs'
import { z } from 'zod'

import { recordAudit, setAuditTarget } from '@/lib/audit'
import { prisma } from '@/lib/database/prisma'
import {
  filePasswordIssue,
  newFilePasswordSchema,
} from '@/lib/files/password-policy'
import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { getStorageProvider } from '@/lib/storage'

const logger = loggers.files

type Context = { params: Promise<{ id: string }> }

const fileUpdateSchema = z.object({
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  password: newFilePasswordSchema.nullable().optional(),
})

const api = routes('/api/files/[id]', {
  invalid: (error) =>
    new HttpError(400, filePasswordIssue(error) ?? 'Invalid request body'),
  failure: { message: 'Failed to update file' },
  logger,
})

export const PATCH = api(async (request, { params }: Context) => {
  const { id } = await params
  const { visibility, password } = fileUpdateSchema.parse(
    await readJson(request)
  )

  const { user } = await requireSession('files.share')

  const file = await prisma.file.findUnique({
    where: { id },
  })

  if (!file) throw new HttpError(404, 'File not found')

  if (file.userId !== user.id) throw new HttpError(401, 'Unauthorized')

  const updates: {
    visibility?: 'PUBLIC' | 'PRIVATE'
    password?: string | null
  } = {}

  if (visibility) {
    updates.visibility = visibility
  }

  if (typeof password !== 'undefined') {
    updates.password = password ? await hash(password, 10) : null
  }

  const updatedFile = await prisma.file.update({
    where: { id },
    data: updates,
  })

  const { password: passwordHash, ...fileMetadata } = updatedFile
  return {
    ...fileMetadata,
    hasPassword: Boolean(passwordHash),
  }
})

export const DELETE = api(
  async (request, { params }: Context) => {
    const { user } = await requireSession('files.delete')

    const { id: fileId } = await params
    const file = await prisma.file.findUnique({
      where: { id: fileId },
    })

    if (!file) throw new HttpError(404, 'File not found')

    if (file.userId !== user.id) throw new HttpError(401, 'Unauthorized')

    setAuditTarget({ type: 'file', id: file.id, name: file.name })
    try {
      const storageProvider = await getStorageProvider()
      await storageProvider.deleteFile(file.path)
      await recordAudit({
        action: 'storage.deleted',
        category: 'storage',
        targetType: 'file',
        targetId: file.id,
        targetName: file.name,
      })
    } catch (error) {
      await recordAudit({
        action: 'storage.delete_failed',
        category: 'storage',
        outcome: 'failure',
        targetType: 'file',
        targetId: file.id,
        targetName: file.name,
        details: {
          reason: 'Storage deletion failed; file metadata deletion continues',
          ownerId: file.userId,
        },
      })
      logger.error('Error deleting file from storage', error as Error, {
        fileId,
        filePath: file.path,
      })
    }

    await prisma.$transaction(async (tx) => {
      await tx.file.delete({
        where: { id: fileId },
      })

      await tx.user.update({
        where: { id: user.id },
        data: {
          storageUsed: {
            decrement: file.size,
          },
        },
      })
    })

    return { success: true }
  },
  { failure: { message: 'Failed to delete file' } }
)
