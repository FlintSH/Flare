import { ProfileResponse, UpdateProfileSchema } from '@/types/dto/profile'
import { Prisma } from '@prisma/client'
import { compare, hash } from 'bcryptjs'
import { unlink } from 'fs/promises'
import { join } from 'path'

import { HTTP_STATUS, apiError, apiResponse } from '@/lib/api/response'
import { requireAuth } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'
import { createRequestLogger, logError, logger } from '@/lib/logging'
import { extractUserContext } from '@/lib/logging/middleware'

export async function PUT(req: Request) {
  const requestLogger = createRequestLogger(req)
  const context = await extractUserContext(req)
  const startTime = Date.now()
  let user: any = null

  try {
    const authResult = await requireAuth(req)
    if (authResult.response) {
      requestLogger.complete(401)
      return authResult.response
    }
    user = authResult.user

    const json = await req.json()

    // Validate request body
    const result = UpdateProfileSchema.safeParse(json)
    if (!result.success) {
      logger.userAction('Profile update failed - validation error', user.id, {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        requestId: requestLogger.requestId,
        metadata: {
          validationError: result.error.issues[0].message,
        },
      })
      requestLogger.complete(400, user.id)
      return apiError(result.error.issues[0].message, HTTP_STATUS.BAD_REQUEST)
    }

    const body = result.data

    logger.userAction('Profile update attempt started', user.id, {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: requestLogger.requestId,
      metadata: {
        fieldsToUpdate: Object.keys(body),
        hasPasswordChange: !!body.newPassword,
        hasEmailChange: !!body.email,
      },
    })

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
        logger.userAction(
          'Profile update failed - email already taken',
          user.id,
          {
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            requestId: requestLogger.requestId,
            metadata: {
              attemptedEmail: body.email,
            },
          }
        )
        requestLogger.complete(400, user.id)
        return apiError('Email already taken', HTTP_STATUS.BAD_REQUEST)
      }
    }

    // If password is being changed, verify current password
    if (body.newPassword) {
      if (!body.currentPassword) {
        logger.userAction(
          'Profile update failed - missing current password',
          user.id,
          {
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            requestId: requestLogger.requestId,
          }
        )
        requestLogger.complete(400, user.id)
        return apiError('Current password is required', HTTP_STATUS.BAD_REQUEST)
      }

      const userData = await prisma.user.findUnique({
        where: { id: user.id },
        select: { password: true },
      })

      if (!userData?.password) {
        logger.userAction('Profile update failed - no password set', user.id, {
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          requestId: requestLogger.requestId,
        })
        requestLogger.complete(400, user.id)
        return apiError('Invalid credentials', HTTP_STATUS.BAD_REQUEST)
      }

      const isPasswordValid = await compare(
        body.currentPassword,
        userData.password
      )

      if (!isPasswordValid) {
        logger.authEvent('Profile update failed - invalid current password', {
          userId: user.id,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          requestId: requestLogger.requestId,
        })
        requestLogger.complete(400, user.id)
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

    const responseTime = Date.now() - startTime

    logger.userAction('Profile updated successfully', user.id, {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      responseTime,
      requestId: requestLogger.requestId,
      metadata: {
        updatedFields: Object.keys(updateData),
        hasPasswordChange: !!body.newPassword,
        hasEmailChange: !!body.email,
      },
    })

    requestLogger.complete(200, user.id, {
      updatedFields: Object.keys(updateData),
    })

    return apiResponse<ProfileResponse>(updatedUser)
  } catch (error) {
    const responseTime = Date.now() - startTime

    logError('user', 'Profile update failed', error as Error, {
      userId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      responseTime,
      requestId: requestLogger.requestId,
    })

    requestLogger.complete(500, user.id, {
      error: error instanceof Error ? error.message : 'Unknown error',
    })

    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}

export async function DELETE(req: Request) {
  const requestLogger = createRequestLogger(req)
  const context = await extractUserContext(req)
  const startTime = Date.now()
  let user: any = null

  try {
    const authResult = await requireAuth(req)
    if (authResult.response) {
      requestLogger.complete(401)
      return authResult.response
    }
    user = authResult.user

    logger.userAction('Account deletion attempt started', user.id, {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: requestLogger.requestId,
    })

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
      logger.userAction('Account deletion failed - user not found', user.id, {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        requestId: requestLogger.requestId,
      })
      requestLogger.complete(404, user.id)
      return apiError('User not found', HTTP_STATUS.NOT_FOUND)
    }

    logger.userAction('Deleting user files from storage', user.id, {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: requestLogger.requestId,
      metadata: {
        fileCount: userData.files.length,
      },
    })

    for (const file of userData.files) {
      try {
        await unlink(join(process.cwd(), file.path))
      } catch (error) {
        logError(
          'user',
          `Error deleting file during account deletion: ${file.path}`,
          error as Error,
          {
            userId: user.id,
            requestId: requestLogger.requestId,
            metadata: {
              filePath: file.path,
            },
          }
        )
      }
    }

    // Delete user's avatar if they have one
    if (userData.image?.startsWith('/avatars/')) {
      try {
        await unlink(join(process.cwd(), 'public', userData.image))
      } catch (error) {
        logError(
          'user',
          'Error deleting avatar during account deletion',
          error as Error,
          {
            userId: user.id,
            requestId: requestLogger.requestId,
            metadata: {
              avatarPath: userData.image,
            },
          }
        )
      }
    }

    // Delete user from database and all their data
    await prisma.user.delete({
      where: { id: user.id },
    })

    const responseTime = Date.now() - startTime

    logger.userAction('Account deleted successfully', user.id, {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      responseTime,
      requestId: requestLogger.requestId,
      metadata: {
        email: userData.email,
        filesDeleted: userData.files.length,
      },
    })

    requestLogger.complete(204, user.id, {
      accountDeleted: true,
      filesDeleted: userData.files.length,
    })

    return new Response(null, { status: HTTP_STATUS.NO_CONTENT })
  } catch (error) {
    const responseTime = Date.now() - startTime
    const userId = user?.id || context.userId

    logError('user', 'Account deletion failed', error as Error, {
      userId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      responseTime,
      requestId: requestLogger.requestId,
    })

    requestLogger.complete(500, userId, {
      error: error instanceof Error ? error.message : 'Unknown error',
    })

    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}
