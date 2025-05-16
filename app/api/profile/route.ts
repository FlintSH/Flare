import { ProfileResponse, UpdateProfileSchema } from '@/types/dto/profile'
import { Prisma } from '@prisma/client'
import { compare, hash } from 'bcryptjs'
import { unlink } from 'fs/promises'
import { join } from 'path'

import { HTTP_STATUS, apiError, apiResponse } from '@/lib/api/response'
import { requireAuth } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'

export async function PUT(req: Request) {
  try {
    const { user, response } = await requireAuth(req)
    if (response) return response

    const json = await req.json()

    // Validate request body
    const result = UpdateProfileSchema.safeParse(json)
    if (!result.success) {
      return apiError(result.error.issues[0].message, HTTP_STATUS.BAD_REQUEST)
    }

    const body = result.data

    // If email is being changed, check if it's already taken
    if (body.email) {
      const existingUser = await prisma.user.findUnique({
        where: {
          email: body.email,
          NOT: {
            id: user.id,
          },
        },
      })

      if (existingUser) {
        return apiError('Email already taken', HTTP_STATUS.BAD_REQUEST)
      }
    }

    // If password is being changed, verify current password
    if (body.newPassword) {
      if (!body.currentPassword) {
        return apiError('Current password is required', HTTP_STATUS.BAD_REQUEST)
      }

      const userData = await prisma.user.findUnique({
        where: { id: user.id },
        select: { password: true },
      })

      if (!userData?.password) {
        return apiError('Invalid credentials', HTTP_STATUS.BAD_REQUEST)
      }

      const isPasswordValid = await compare(
        body.currentPassword,
        userData.password
      )

      if (!isPasswordValid) {
        return apiError('Invalid credentials', HTTP_STATUS.BAD_REQUEST)
      }
    }

    // Update user data
    const updateData: Prisma.UserUpdateInput = {}
    if (body.name) updateData.name = body.name
    if (body.email) updateData.email = body.email
    if (body.newPassword) updateData.password = await hash(body.newPassword, 10)
    if (body.image) updateData.image = body.image
    if (typeof body.randomizeFileUrls === 'boolean')
      updateData.randomizeFileUrls = body.randomizeFileUrls

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        randomizeFileUrls: true,
      },
    })

    return apiResponse<ProfileResponse>(updatedUser)
  } catch (error) {
    console.error('Profile update error:', error)
    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}

export async function DELETE(req: Request) {
  try {
    const { user, response } = await requireAuth(req)
    if (response) return response

    // Get user's files to nuke them from storage
    const userData = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        files: {
          select: {
            path: true,
          },
        },
      },
    })

    if (!userData) {
      return apiError('User not found', HTTP_STATUS.NOT_FOUND)
    }

    for (const file of userData.files) {
      try {
        await unlink(join(process.cwd(), file.path))
      } catch (error) {
        console.error(`Error deleting file ${file.path}:`, error)
      }
    }

    // Delete user's avatar if they have one
    if (userData.image?.startsWith('/avatars/')) {
      try {
        await unlink(join(process.cwd(), 'public', userData.image))
      } catch (error) {
        console.error('Error deleting avatar:', error)
      }
    }

    // Delete user from database and all their data
    await prisma.user.delete({
      where: { id: user.id },
    })

    return new Response(null, { status: HTTP_STATUS.NO_CONTENT })
  } catch (error) {
    console.error('Account deletion error:', error)
    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}
