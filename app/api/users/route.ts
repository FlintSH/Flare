import { UserResponse, UserSchema } from '@/types/dto/user'
import type { Prisma } from '@prisma/client'
import { hash } from 'bcryptjs'

import {
  HTTP_STATUS,
  apiError,
  apiResponse,
  paginatedResponse,
} from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'
import {
  lockEmailAddress,
  lockEmailUser,
  sendAccountToken,
} from '@/lib/email/account'
import { getEmailConfigForUpdate } from '@/lib/email/config'
import { hasDurableEmailAccess } from '@/lib/email/policy'
import { invalidateEmailTokens } from '@/lib/email/tokens'
import { loggers } from '@/lib/logger'
import { getStorageProvider } from '@/lib/storage'
import { createUser } from '@/lib/users/create-user'

const logger = loggers.users

class UserEmailPolicyError extends Error {}

export async function GET(req: Request) {
  try {
    const { response } = await requireAdmin()
    if (response) return response

    const { searchParams } = new URL(req.url)
    const requestedPage = Number(searchParams.get('page') || '1')
    const requestedLimit = Number(searchParams.get('limit') || '25')
    const safePage =
      Number.isSafeInteger(requestedPage) && requestedPage > 0
        ? requestedPage
        : 1
    const limit =
      Number.isSafeInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 100)
        : 25
    const search = (searchParams.get('search') || '').trim().slice(0, 200)
    const role = searchParams.get('role')
    const where: Prisma.UserWhereInput = {
      ...(role === 'ADMIN' || role === 'USER' ? { role } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    }
    const total = await prisma.user.count({ where })
    const page = Math.min(safePage, Math.max(1, Math.ceil(total / limit)))
    const skip = (page - 1) * limit

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
        urlId: true,
        vanityId: true,
        storageUsed: true,
        _count: {
          select: {
            files: true,
            shortenedUrls: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      skip,
      take: limit,
    })

    const pagination = {
      total,
      pageCount: Math.ceil(total / limit),
      page,
      limit,
    }

    return paginatedResponse<UserResponse[]>(users, pagination)
  } catch (error) {
    logger.error('Error fetching users', error as Error)
    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}

export async function POST(req: Request) {
  try {
    const { response } = await requireAdmin()
    if (response) return response

    const json = await req.json()

    const result = UserSchema.safeParse(json)
    if (!result.success) {
      return apiError(result.error.issues[0].message, HTTP_STATUS.BAD_REQUEST)
    }

    const body = result.data
    const exists = await prisma.user.findUnique({
      where: { email: body.email },
    })

    if (exists) {
      return apiError('User already exists', HTTP_STATUS.BAD_REQUEST)
    }

    const hashedPassword = body.password
      ? await hash(body.password, 10)
      : undefined

    const user = await prisma.$transaction(async (tx) => {
      const emailConfig = await getEmailConfigForUpdate(tx)
      if (
        emailConfig.enabled &&
        body.password &&
        Buffer.byteLength(body.password, 'utf8') > 72
      )
        throw new UserEmailPolicyError('Password must use at most 72 bytes.')
      const sendVerification =
        emailConfig.enabled &&
        (emailConfig.verification.mode !== 'off' ||
          emailConfig.recovery.enabled)
      if (emailConfig.enabled) {
        await lockEmailAddress(tx, body.email)
        if (
          await tx.user.findFirst({
            where: { email: { equals: body.email, mode: 'insensitive' } },
          })
        )
          throw new Error('Email already exists')
      }
      const created = await createUser(tx, {
        email: body.email,
        name: body.name,
        password: hashedPassword,
        role: body.role,
        emailExempt: emailConfig.verification.adminCreated === 'exempt',
        ...(sendVerification
          ? { emailVerificationSource: 'pending_local' }
          : {}),
      })
      if (sendVerification)
        await sendAccountToken(tx, created, 'verify', emailConfig)
      return created
    })

    return apiResponse<UserResponse>({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: user.role,
      urlId: user.urlId,
      vanityId: user.vanityId,
      storageUsed: user.storageUsed,
      _count: { files: 0, shortenedUrls: 0 },
    })
  } catch (error) {
    if (error instanceof UserEmailPolicyError)
      return apiError(error.message, HTTP_STATUS.BAD_REQUEST)
    logger.error('Error creating user', error as Error)
    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}

export async function PUT(req: Request) {
  try {
    const { response } = await requireAdmin()
    if (response) return response

    const json = await req.json()

    const result = UserSchema.safeParse(json)
    if (!result.success) {
      return apiError(result.error.issues[0].message, HTTP_STATUS.BAD_REQUEST)
    }

    const body = result.data

    if (!body.id) {
      return apiError('User ID is required', HTTP_STATUS.BAD_REQUEST)
    }

    const existingUser = await prisma.user.findUnique({
      where: { id: body.id },
    })

    if (!existingUser) {
      return apiError('User not found', HTTP_STATUS.NOT_FOUND)
    }
    const requestedEmailChange =
      body.email !== undefined && body.email !== existingUser.email
    const requestedRoleChange = body.role !== existingUser.role

    if (body.urlId) {
      const existingUrlId = await prisma.user.findUnique({
        where: { urlId: body.urlId },
      })
      if (existingUrlId && existingUrlId.id !== body.id) {
        return apiError('URL ID is already in use', HTTP_STATUS.BAD_REQUEST)
      }
    }

    if (body.vanityId !== undefined && body.vanityId !== null) {
      // Check vanityId doesn't collide with another user's vanityId
      const existingVanity = await prisma.user.findUnique({
        where: { vanityId: body.vanityId },
      })
      if (existingVanity && existingVanity.id !== body.id) {
        return apiError(
          'This vanity URL is already taken',
          HTTP_STATUS.BAD_REQUEST
        )
      }

      // Check vanityId doesn't collide with any user's urlId
      const existingVanityAsUrlId = await prisma.user.findUnique({
        where: { urlId: body.vanityId },
      })
      if (existingVanityAsUrlId) {
        return apiError(
          'This vanity URL conflicts with an existing URL ID',
          HTTP_STATUS.BAD_REQUEST
        )
      }
    }

    const updateData = {
      updatedAt: new Date(),
      ...(body.name !== undefined && { name: body.name }),
      ...(requestedEmailChange && { email: body.email }),
      ...(requestedRoleChange && { role: body.role }),
      ...(body.password && { password: await hash(body.password, 10) }),
      ...(body.urlId && { urlId: body.urlId }),
      ...(body.vanityId !== undefined && {
        vanityId: body.vanityId || null,
      }),
    }

    if (body.urlId && body.urlId !== existingUser.urlId) {
      try {
        const storageProvider = await getStorageProvider()
        const oldPath = `uploads/${existingUser.urlId}`
        const newPath = `uploads/${body.urlId}`
        await storageProvider.renameFolder(oldPath, newPath)

        const files = await prisma.file.findMany({
          where: { userId: body.id },
          select: { id: true, path: true, urlPath: true },
        })

        for (const file of files) {
          await prisma.file.update({
            where: { id: file.id },
            data: {
              path: file.path.replace(`${oldPath}/`, `${newPath}/`),
              urlPath: file.urlPath.replace(
                `/${existingUser.urlId}/`,
                `/${body.urlId}/`
              ),
            },
          })
        }
      } catch (error) {
        logger.error('Error renaming user folder', error as Error)
        return apiError(
          'Failed to rename user folder',
          HTTP_STATUS.INTERNAL_SERVER_ERROR
        )
      }
    }

    const user = await prisma.$transaction(async (tx) => {
      const latestConfig = await getEmailConfigForUpdate(tx)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(712347202)`
      const currentUser = await lockEmailUser(tx, existingUser.id)
      if (
        (requestedEmailChange && currentUser.email !== existingUser.email) ||
        (requestedRoleChange && currentUser.role !== existingUser.role) ||
        (body.password &&
          (currentUser.password !== existingUser.password ||
            currentUser.sessionVersion !== existingUser.sessionVersion))
      )
        throw new UserEmailPolicyError(
          'Account changed during update. Refresh the user and try again.'
        )
      if (
        latestConfig.enabled &&
        body.password &&
        Buffer.byteLength(body.password, 'utf8') > 72
      )
        throw new UserEmailPolicyError('Password must use at most 72 bytes.')

      // Full user forms carry unchanged identity fields. Preserve concurrent
      // verification or role changes unless this request actually edited them.
      const emailChanged =
        requestedEmailChange && body.email !== currentUser.email
      const nextRole = requestedRoleChange ? body.role : currentUser.role
      if (
        latestConfig.enabled &&
        currentUser.role === 'ADMIN' &&
        (emailChanged || nextRole !== 'ADMIN')
      ) {
        const admins = await tx.user.findMany({ where: { role: 'ADMIN' } })
        const remainsAccessible = admins.some((admin) => {
          if (admin.id !== existingUser.id)
            return hasDurableEmailAccess(admin, latestConfig)
          if (nextRole !== 'ADMIN') return false
          return hasDurableEmailAccess(
            emailChanged
              ? {
                  ...admin,
                  emailVerified: null,
                  emailVerifiedFor: null,
                  emailVerificationSource: null,
                }
              : admin,
            latestConfig
          )
        })
        if (!remainsAccessible)
          throw new UserEmailPolicyError(
            'Verify or exempt another administrator before changing the last administrator recovery address or role'
          )
      }
      if (emailChanged || body.password) {
        if (latestConfig.enabled && emailChanged) {
          await lockEmailAddress(tx, body.email)
          if (
            await tx.user.findFirst({
              where: {
                id: { not: existingUser.id },
                email: { equals: body.email, mode: 'insensitive' },
              },
            })
          )
            throw new UserEmailPolicyError('Email already exists')
        }
        await invalidateEmailTokens(tx, existingUser.id)
      }
      return tx.user.update({
        where: { id: body.id },
        data: {
          ...updateData,
          ...(emailChanged && {
            emailVerified: null,
            emailVerifiedFor: null,
            emailVerificationSource: null,
            pendingEmail: null,
            pendingEmailOldConfirmed: false,
          }),
          ...(latestConfig.enabled && (emailChanged || body.password)
            ? { sessionVersion: { increment: 1 } }
            : {}),
          ...(latestConfig.enabled && body.password
            ? { pendingEmail: null, pendingEmailOldConfirmed: false }
            : {}),
        },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          role: true,
          urlId: true,
          vanityId: true,
          storageUsed: true,
          _count: {
            select: {
              files: true,
              shortenedUrls: true,
            },
          },
        },
      })
    })

    return apiResponse<UserResponse>(user)
  } catch (error) {
    if (error instanceof UserEmailPolicyError)
      return apiError(error.message, HTTP_STATUS.BAD_REQUEST)
    logger.error('Error updating user', error as Error)
    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}
