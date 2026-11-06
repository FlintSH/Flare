import { NextResponse } from 'next/server'

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
import { assertSameOrigin, readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { getStorageProvider } from '@/lib/storage'

const logger = loggers.files

type Context = { params: Promise<{ id: string; fileId: string }> }

const api = routes('/api/users/[id]/files/[fileId]', {
  failure: { message: 'Internal Server Error' },
  logger,
})

export const DELETE = api(async (request, { params }: Context) => {
  assertSameOrigin(request)
  await requireSession('content.delete')
  const { id: userId, fileId } = await params

  const file = await prisma.file.findUnique({
    where: {
      id: fileId,
      userId,
    },
  })

  if (!file) {
    throw new HttpError(404, 'File not found')
  }

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
    logger.error('Error deleting file from storage:', error as Error)
  }

  await prisma.$transaction(async (tx) => {
    await tx.file.delete({
      where: {
        id: fileId,
        userId,
      },
    })

    await tx.user.update({
      where: { id: userId },
      data: {
        storageUsed: {
          decrement: file.size,
        },
      },
    })
  })

  return new NextResponse(null, { status: 204 })
})

export const PATCH = api(async (request, { params }: Context) => {
  assertSameOrigin(request)
  await requireSession('content.update')
  const { id: userId, fileId } = await params

  const body = await readJson(request)
  const parsed = z
    .object({
      visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
      password: newFilePasswordSchema.nullable().optional(),
    })
    .strict()
    .safeParse(body)
  if (!parsed.success)
    throw new HttpError(
      400,
      filePasswordIssue(parsed.error) ?? 'Invalid file settings'
    )
  const { visibility, password } = parsed.data

  const file = await prisma.file.update({
    where: {
      id: fileId,
      userId,
    },
    data: {
      visibility,
      ...(password !== undefined && {
        password: password ? await hash(password, 10) : null,
      }),
    },
  })

  const { password: secret, ...metadata } = file
  return NextResponse.json({ ...metadata, hasPassword: Boolean(secret) })
})
