import { NextResponse } from 'next/server'

import { hash } from 'bcryptjs'
import { z } from 'zod'

import { recordAudit, setAuditTarget, withAuditRoute } from '@/lib/audit'
import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { requirePermission } from '@/lib/permissions/server'
import { getStorageProvider } from '@/lib/storage'

const logger = loggers.files

async function handlePATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const schema = z.object({
      visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
      password: z.string().nullable().optional(),
    })
    const result = schema.safeParse(body)
    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      )
    }

    const { session, response: permissionDenied } =
      await requirePermission('files.share')
    if (permissionDenied) return permissionDenied
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const file = await prisma.file.findUnique({
      where: { id },
    })

    if (!file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    if (file.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const {
      visibility,
      password,
    }: {
      visibility?: 'PUBLIC' | 'PRIVATE'
      password?: string | null
    } = result.data

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
    return NextResponse.json({
      ...fileMetadata,
      hasPassword: Boolean(passwordHash),
    })
  } catch (error) {
    logger.error('File update error', error as Error)
    return NextResponse.json(
      { error: 'Failed to update file' },
      { status: 500 }
    )
  }
}

async function handleDELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { session, response: permissionDenied } =
      await requirePermission('files.delete')
    if (permissionDenied) return permissionDenied
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: fileId } = await params
    const file = await prisma.file.findUnique({
      where: { id: fileId },
    })

    if (!file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    if (file.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
        where: { id: session.user.id },
        data: {
          storageUsed: {
            decrement: file.size,
          },
        },
      })
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('File delete error', error as Error)
    return NextResponse.json(
      { error: 'Failed to delete file' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuditRoute(async () => handlePATCH(request, { params }), {
    route: '/api/files/[id]',
  })(request)
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuditRoute(async () => handleDELETE(req, { params }), {
    route: '/api/files/[id]',
  })(req)
}
