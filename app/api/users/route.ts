import { UserResponse, UserSchema } from '@/types/dto/user'
import type { Prisma } from '@prisma/client'
import { hash } from 'bcryptjs'

import {
  HTTP_STATUS,
  apiError,
  apiResponse,
  paginatedResponse,
} from '@/lib/api/response'
import { requirePermission } from '@/lib/auth/api-auth'
import { prisma } from '@/lib/database/prisma'
import {
  lockEmailAddress,
  lockEmailUser,
  sendAccountToken,
} from '@/lib/email/account'
import { getEmailConfigForUpdate } from '@/lib/email/config'
import { invalidateEmailTokens } from '@/lib/email/tokens'
import { loggers } from '@/lib/logger'
import { roleMutationGuard } from '@/lib/permissions/http'
import {
  PermissionError,
  assertAccessibleAdministrator,
  assertCanManageUser,
  getUserAccess,
  lockRoleChanges,
  requireActorPermission,
  validateRoleAssignment,
} from '@/lib/permissions/server'
import { createUser } from '@/lib/users/create-user'

const logger = loggers.users

class UserEmailPolicyError extends Error {}

export async function GET(req: Request) {
  try {
    const { response } = await requirePermission('users.read')
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
    const roleId = searchParams.get('roleId')
    const everyone = await prisma.role.findUnique({
      where: { systemKey: 'everyone' },
    })
    const where: Prisma.UserWhereInput = {
      ...(roleId && roleId !== everyone?.id
        ? { roles: { some: { id: roleId } } }
        : {}),
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
        roles: true,
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

    return paginatedResponse<UserResponse[]>(
      users.map((user) => ({
        ...user,
        roles: [...user.roles, ...(everyone ? [everyone] : [])],
      })),
      pagination
    )
  } catch (error) {
    if (error instanceof PermissionError)
      return apiError(error.message, error.status)
    logger.error('Error fetching users', error as Error)
    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}

export async function POST(req: Request) {
  const rejected = roleMutationGuard(req)
  if (rejected) return rejected
  try {
    const { user: actor, response } = await requirePermission('users.create')
    if (response) return response

    const json = await req.json().catch(() => null)
    if (!json || typeof json !== 'object' || Array.isArray(json))
      return apiError('Provide a JSON object', 400)

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
      await lockRoleChanges(tx)
      await requireActorPermission(tx, actor.id, 'users.create')
      if (body.roleIds?.length) {
        await requireActorPermission(tx, actor.id, 'users.roles')
        await validateRoleAssignment(tx, actor.id, null, body.roleIds)
      }
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
        roleIds: body.roleIds,
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
      roles: (await getUserAccess(user.id)).roles,
      urlId: user.urlId,
      vanityId: user.vanityId,
      storageUsed: user.storageUsed,
      _count: { files: 0, shortenedUrls: 0 },
    })
  } catch (error) {
    if (error instanceof PermissionError)
      return apiError(error.message, error.status)
    if (error instanceof UserEmailPolicyError)
      return apiError(error.message, HTTP_STATUS.BAD_REQUEST)
    logger.error('Error creating user', error as Error)
    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}

export async function PUT(req: Request) {
  const rejected = roleMutationGuard(req)
  if (rejected) return rejected
  try {
    const json = await req.json().catch(() => null)
    if (!json || typeof json !== 'object' || Array.isArray(json))
      return apiError('Provide a JSON object', 400)
    const requiredPermission = Object.keys(json).some(
      (key) => !['id', 'roleIds'].includes(key)
    )
      ? 'users.update'
      : 'users.roles'
    const { user: actor, response } =
      await requirePermission(requiredPermission)
    if (response) return response

    const result = UserSchema.partial().safeParse(json)
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
    const requestedUrlIdChange =
      body.urlId !== undefined && body.urlId !== existingUser.urlId

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
      ...(body.password && { password: await hash(body.password, 10) }),
      ...(requestedUrlIdChange && { urlId: body.urlId }),
      ...(body.vanityId !== undefined && {
        vanityId: body.vanityId || null,
      }),
    }

    const user = await prisma.$transaction(async (tx) => {
      await lockRoleChanges(tx)
      await requireActorPermission(tx, actor.id, requiredPermission)
      await assertCanManageUser(tx, actor.id, existingUser.id)
      const latestConfig = await getEmailConfigForUpdate(tx)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(712347202)`
      const currentUser = await lockEmailUser(tx, existingUser.id)
      if (
        (requestedEmailChange && currentUser.email !== existingUser.email) ||
        (requestedUrlIdChange && currentUser.urlId !== existingUser.urlId) ||
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
      let roles: { set: { id: string }[] } | undefined
      if (body.roleIds !== undefined) {
        const currentRoles = await tx.user.findUniqueOrThrow({
          where: { id: currentUser.id },
          select: { roles: { select: { id: true } } },
        })
        const changed =
          JSON.stringify(currentRoles.roles.map((r) => r.id).sort()) !==
          JSON.stringify([...new Set(body.roleIds)].sort())
        if (changed) {
          await requireActorPermission(tx, actor.id, 'users.roles')
          await validateRoleAssignment(
            tx,
            actor.id,
            currentUser.id,
            body.roleIds
          )
          roles = { set: body.roleIds.map((id) => ({ id })) }
        }
      }
      if (emailChanged || body.password) {
        if (latestConfig.enabled && emailChanged) {
          await lockEmailAddress(tx, body.email!)
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
      if (requestedUrlIdChange) {
        // Public URLs and the user ID must change together. Storage paths are
        // independent: moving objects can strand files if storage or DB writes fail.
        const files = await tx.file.findMany({
          where: { userId: existingUser.id },
          select: { id: true, urlPath: true },
        })
        for (const file of files) {
          await tx.file.update({
            where: { id: file.id },
            data: {
              urlPath: file.urlPath.replace(
                `/${currentUser.urlId}/`,
                `/${body.urlId}/`
              ),
            },
          })
        }
      }
      const updated = await tx.user.update({
        where: { id: body.id },
        data: {
          ...updateData,
          ...(roles ? { roles } : {}),
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
          roles: true,
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
      await assertAccessibleAdministrator(tx, latestConfig)
      return updated
    })

    return apiResponse<UserResponse>({
      ...user,
      roles: (await getUserAccess(user.id)).roles,
    })
  } catch (error) {
    if (error instanceof PermissionError)
      return apiError(error.message, error.status)
    if (error instanceof UserEmailPolicyError)
      return apiError(error.message, HTTP_STATUS.BAD_REQUEST)
    logger.error('Error updating user', error as Error)
    return apiError('Internal server error', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}
