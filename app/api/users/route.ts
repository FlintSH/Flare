import { UserResponse, UserSchema } from '@/types/dto/user'
import type { Prisma } from '@prisma/client'
import { hash } from 'bcryptjs'

import { lockRoleChanges } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { lockEmailUser } from '@/lib/email/account'
import { getEmailConfigForUpdate } from '@/lib/email/config'
import { emailRoutes } from '@/lib/email/http'
import { MailLimitError } from '@/lib/email/outbox'
import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { assertJsonMutation, readJson } from '@/lib/http/request'
import { apiResponse, paginatedResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { EVERYONE_ROLE } from '@/lib/permissions/policy'
import {
  assertAccessibleAdministrator,
  assertCanManageUser,
  getUserAccess,
  requireActorPermission,
  validateRoleAssignment,
} from '@/lib/permissions/server'
import { createAccount } from '@/lib/users/create-account'
import { changeCredentials } from '@/lib/users/credentials'
import { claimEmail } from '@/lib/users/email-claim'

class UserEmailPolicyError extends HttpError {
  constructor(message: string) {
    super(400, message)
  }
}

const api = routes('/api/users', {
  envelope: 'api',
  // A full daily mail cap stops the verification email; answer it as the
  // email routes do.
  translate: (error) =>
    error instanceof MailLimitError
      ? new HttpError(
          emailRoutes.failure.status ?? 500,
          emailRoutes.failure.message
        )
      : undefined,
  failure: { message: 'Internal server error' },
  logger: loggers.users,
})

export const GET = api(async (request) => {
  await requireSession('users.read')

  const { searchParams } = new URL(request.url)
  const requestedPage = Number(searchParams.get('page') || '1')
  const requestedLimit = Number(searchParams.get('limit') || '25')
  const safePage =
    Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const limit =
    Number.isSafeInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 100)
      : 25
  const search = (searchParams.get('search') || '').trim().slice(0, 200)
  const roleId = searchParams.get('roleId')
  const everyone = await prisma.role.findUnique({
    where: { systemKey: EVERYONE_ROLE },
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
      invite: { select: { creator: { select: { id: true, name: true } } } },
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
    users.map(({ invite, ...user }) => ({
      ...user,
      roles: [
        ...user.roles.filter((role) => role.id !== everyone?.id),
        ...(everyone ? [everyone] : []),
      ],
      invitedBy: invite?.creator ?? null,
    })),
    pagination
  )
})

export const POST = api(async (request) => {
  assertJsonMutation(request)
  const { user: actor } = await requireSession('users.create')

  const json = await readJson(request)
  if (!json || typeof json !== 'object' || Array.isArray(json))
    throw new HttpError(400, 'Provide a JSON object')

  const result = UserSchema.safeParse(json)
  if (!result.success) {
    throw new HttpError(400, result.error.issues[0].message)
  }

  const body = result.data
  const exists = await prisma.user.findUnique({
    where: { email: body.email },
  })

  if (exists) {
    throw new HttpError(400, 'User already exists')
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
    const created = await createAccount(
      tx,
      {
        email: body.email,
        name: body.name,
        password: hashedPassword,
        roleIds: body.roleIds,
        emailExempt: emailConfig.verification.adminCreated === 'exempt',
      },
      { verifyWith: emailConfig }
    )
    if (!created) throw new UserEmailPolicyError('Email already exists')
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
})

export const PUT = api(async (request) => {
  assertJsonMutation(request)
  const json = await readJson(request)
  if (!json || typeof json !== 'object' || Array.isArray(json))
    throw new HttpError(400, 'Provide a JSON object')
  const requiredPermission = Object.keys(json).some(
    (key) => !['id', 'roleIds'].includes(key)
  )
    ? 'users.update'
    : 'users.roles'
  const { user: actor } = await requireSession(requiredPermission)

  const result = UserSchema.partial().safeParse(json)
  if (!result.success) {
    throw new HttpError(400, result.error.issues[0].message)
  }

  const body = result.data

  if (!body.id) {
    throw new HttpError(400, 'User ID is required')
  }

  const existingUser = await prisma.user.findUnique({
    where: { id: body.id },
  })

  if (!existingUser) {
    throw new HttpError(404, 'User not found')
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
      throw new HttpError(400, 'URL ID is already in use')
    }
  }

  if (body.vanityId !== undefined && body.vanityId !== null) {
    // Check vanityId doesn't collide with another user's vanityId
    const existingVanity = await prisma.user.findUnique({
      where: { vanityId: body.vanityId },
    })
    if (existingVanity && existingVanity.id !== body.id) {
      throw new HttpError(400, 'This vanity URL is already taken')
    }

    // Check vanityId doesn't collide with any user's urlId
    const existingVanityAsUrlId = await prisma.user.findUnique({
      where: { urlId: body.vanityId },
    })
    if (existingVanityAsUrlId) {
      throw new HttpError(
        400,
        'This vanity URL conflicts with an existing URL ID'
      )
    }
  }

  const updateData = {
    updatedAt: new Date(),
    ...(body.name !== undefined && { name: body.name }),
    ...(requestedUrlIdChange && { urlId: body.urlId }),
    ...(body.vanityId !== undefined && {
      vanityId: body.vanityId || null,
    }),
  }
  const passwordHash = body.password ? await hash(body.password, 10) : undefined

  const user = await prisma.$transaction(async (tx) => {
    await lockRoleChanges(tx)
    await requireActorPermission(tx, actor.id, requiredPermission)
    await assertCanManageUser(tx, actor.id, existingUser.id)
    const latestConfig = await getEmailConfigForUpdate(tx)
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
        await validateRoleAssignment(tx, actor.id, currentUser.id, body.roleIds)
        roles = { set: body.roleIds.map((id) => ({ id })) }
      }
    }
    if (
      emailChanged &&
      latestConfig.enabled &&
      !(await claimEmail(tx, body.email!, existingUser.id))
    )
      throw new UserEmailPolicyError('Email already exists')
    if (emailChanged || passwordHash)
      await changeCredentials(tx, existingUser.id, {
        password: passwordHash,
        ...(emailChanged && {
          email: { address: body.email!, verified: false },
        }),
      })
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
      data: { ...updateData, ...(roles ? { roles } : {}) },
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
})
