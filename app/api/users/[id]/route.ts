import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'
import { join } from 'path'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { getStorageProvider } from '@/lib/storage'

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    const { id } = await params

    if (!session?.user || session.user.role !== 'ADMIN') {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    // Get user's files to delete them from storage
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        files: {
          select: {
            path: true,
          },
        },
      },
    })

    if (!user) {
      return new NextResponse('User not found', { status: 404 })
    }

    // Get storage provider
    const storageProvider = await getStorageProvider()

    // Delete user's files from storage
    for (const file of user.files) {
      try {
        await storageProvider.deleteFile(file.path)
      } catch (error) {
        console.error(`Error deleting file ${file.path}:`, error)
      }
    }

    // Delete user's avatar if exists
    if (user.image?.startsWith('/api/avatars/')) {
      try {
        const avatarPath = join(
          'uploads',
          'avatars',
          user.image.split('/').pop() || ''
        )
        await storageProvider.deleteFile(avatarPath)
      } catch (error) {
        console.error('Error deleting avatar:', error)
      }
    }

    // Nuke user from database
    await prisma.user.delete({
      where: { id },
    })

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error('Error deleting user:', error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
