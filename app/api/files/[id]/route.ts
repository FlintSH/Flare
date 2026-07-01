import { NextResponse } from 'next/server'

import { UpdateFileSchema } from '@/types/dto/file'
import { Prisma } from '@prisma/client'
import { hash } from 'bcryptjs'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { loggers } from '@/lib/logger'
import { isOrganizationEnabled } from '@/lib/organization'
import { getStorageProvider } from '@/lib/storage'

const logger = loggers.files

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const result = UpdateFileSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json(
        { error: result.error.issues[0]?.message || 'Invalid request body' },
        { status: 400 }
      )
    }

    const session = await getServerSession(authOptions)
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

    const { visibility, password, folderId, tagIds } = result.data

    const orgEnabled =
      folderId !== undefined || tagIds !== undefined
        ? await isOrganizationEnabled()
        : false

    // Validate folder ownership before touching anything.
    if (orgEnabled && folderId) {
      const folder = await prisma.folder.findFirst({
        where: { id: folderId, userId: session.user.id },
        select: { id: true },
      })
      if (!folder) {
        return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
      }
    }

    // Validate that any provided tags belong to the user.
    let validTagIds: string[] = []
    if (orgEnabled && tagIds !== undefined) {
      if (tagIds.length > 0) {
        const owned = await prisma.tag.findMany({
          where: { id: { in: tagIds }, userId: session.user.id },
          select: { id: true },
        })
        validTagIds = owned.map((t) => t.id)
      }
    }

    const updates: Prisma.FileUpdateInput = {}

    if (visibility) {
      updates.visibility = visibility
    }

    if (typeof password !== 'undefined') {
      updates.password = password ? await hash(password, 10) : null
    }

    if (orgEnabled && folderId !== undefined) {
      updates.folder = folderId
        ? { connect: { id: folderId } }
        : { disconnect: true }
    }

    const updatedFile = await prisma.$transaction(async (tx) => {
      if (orgEnabled && tagIds !== undefined) {
        // Full replacement of the file's tags.
        await tx.fileTag.deleteMany({ where: { fileId: id } })
        if (validTagIds.length > 0) {
          await tx.fileTag.createMany({
            data: validTagIds.map((tagId) => ({ fileId: id, tagId })),
          })
        }
      }
      return tx.file.update({
        where: { id },
        data: updates,
      })
    })

    return NextResponse.json(updatedFile)
  } catch (error) {
    logger.error('File update error', error as Error)
    return NextResponse.json(
      { error: 'Failed to update file' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
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

    try {
      const storageProvider = await getStorageProvider()
      await storageProvider.deleteFile(file.path)
    } catch (error) {
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
