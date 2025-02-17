import { NextResponse } from 'next/server'

import { hash } from 'bcryptjs'
import { getServerSession } from 'next-auth'
import { z } from 'zod'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { getStorageProvider } from '@/lib/storage'

export async function PATCH(
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

    return NextResponse.json(updatedFile)
  } catch (error) {
    console.error('File update error:', error)
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

    // Delete file from storage first
    try {
      const storageProvider = await getStorageProvider()
      await storageProvider.deleteFile(file.path)
    } catch (error) {
      console.error('Error deleting file from storage:', error)
    }

    // Delete from database and update storage usage in a transaction (regardless of if storage deletion worked or not)
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
    console.error('File delete error:', error)
    return NextResponse.json(
      { error: 'Failed to delete file' },
      { status: 500 }
    )
  }
}
