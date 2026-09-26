import { NextResponse } from 'next/server'

import { hash } from 'bcryptjs'
import { z } from 'zod'

import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { requirePermission } from '@/lib/permissions/server'
import { isSameOriginRequest } from '@/lib/security/request-origin'
import { getStorageProvider } from '@/lib/storage'

const logger = loggers.files

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
): Promise<NextResponse> {
  if (!isSameOriginRequest(request))
    return new NextResponse('Invalid request origin', { status: 403 })
  try {
    const { session, response: permissionDenied } =
      await requirePermission('content.delete')
    if (permissionDenied) return permissionDenied
    const { id: userId, fileId } = await params

    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const file = await prisma.file.findUnique({
      where: {
        id: fileId,
        userId,
      },
    })

    if (!file) {
      return new NextResponse('File not found', { status: 404 })
    }

    try {
      const storageProvider = await getStorageProvider()
      await storageProvider.deleteFile(file.path)
    } catch (error) {
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
  } catch (error) {
    logger.error('Error deleting file:', error as Error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
): Promise<NextResponse> {
  if (!isSameOriginRequest(request))
    return new NextResponse('Invalid request origin', { status: 403 })
  try {
    const { session, response: permissionDenied } =
      await requirePermission('content.update')
    if (permissionDenied) return permissionDenied
    const { id: userId, fileId } = await params

    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const body = await request.json()
    const parsed = z
      .object({
        visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
        password: z.string().max(256).nullable().optional(),
      })
      .strict()
      .safeParse(body)
    if (!parsed.success)
      return NextResponse.json(
        { error: 'Invalid file settings' },
        { status: 400 }
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
  } catch (error) {
    logger.error('Error updating file:', error as Error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
