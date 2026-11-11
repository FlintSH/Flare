import { UserResponse, UserSchema } from '@/types/dto/user'
import type { Prisma } from '@prisma/client'

import { lockRoleChanges } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { getEmailConfigForUpdate } from '@/lib/email/config'
import { assertPermission, requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { pageWindow } from '@/lib/http/pagination'
import { readJson } from '@/lib/http/request'
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
import { hashAccountPassword } from '@/lib/users/credentials'
import { updateAccount } from '@/lib/users/update-account'

const api = routes('/api/users', {
  envelope: 'api',
  failure: { message: 'Internal server error' },
  logger: loggers.users,
})

export const GET = api(async (request) => {
  await requireSession(request, 'users.read')

  const { searchParams } = new URL(request.url)
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
  const { page, pages, limit, skip } = pageWindow(
    total,
    {
      page: Number(searchParams.get('page')),
      limit: Number(searchParams.get('limit')),
    },
    { defaultLimit: 25, maxLimit: 100 }
  )

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
      // Read only to report whether the account has keys. Never returned.
      authPublicKey: true,
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
    pageCount: pages,
    page,
    limit,
  }

  return paginatedResponse<UserResponse[]>(
    users.map(({ invite, authPublicKey, ...user }) => ({
      ...user,
      hasPassphrase: Boolean(authPublicKey),
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
  const { user: actor } = await requireSession(request, 'users.create')

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
    ? await hashAccountPassword(body.password)
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
    if (!created) throw new HttpError(400, 'Email already exists')
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
  const { user: actor } = await requireSession(request)
  const json = await readJson(request)
  if (!json || typeof json !== 'object' || Array.isArray(json))
    throw new HttpError(400, 'Provide a JSON object')
  const requiredPermission = Object.keys(json).some(
    (key) => !['id', 'roleIds'].includes(key)
  )
    ? 'users.update'
    : 'users.roles'
  assertPermission(actor, requiredPermission)

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

  const passwordHash = body.password
    ? await hashAccountPassword(body.password)
    : undefined

  const user = await prisma.$transaction(async (tx) => {
    await lockRoleChanges(tx)
    await requireActorPermission(tx, actor.id, requiredPermission)
    await assertCanManageUser(tx, actor.id, existingUser.id)
    const latestConfig = await getEmailConfigForUpdate(tx)
    const { roleIds } = body
    const updated = await updateAccount(
      tx,
      existingUser,
      {
        name: body.name,
        email: body.email,
        password: passwordHash,
        urlId: body.urlId,
        vanityId: body.vanityId,
        settings: { updatedAt: new Date() },
      },
      {
        kind: 'administrator',
        emailEnabled: latestConfig.enabled,
        // Full user forms carry the roles unchanged. Keep a concurrent role
        // change unless this request actually edits them.
        roles: roleIds
          ? async (account) => {
              const current = await tx.user.findUniqueOrThrow({
                where: { id: account.id },
                select: { roles: { select: { id: true } } },
              })
              if (
                JSON.stringify(current.roles.map((r) => r.id).sort()) ===
                JSON.stringify([...new Set(roleIds)].sort())
              )
                return undefined
              await requireActorPermission(tx, actor.id, 'users.roles')
              await validateRoleAssignment(tx, actor.id, account.id, roleIds)
              return { set: roleIds.map((id) => ({ id })) }
            }
          : undefined,
      },
      {
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
      }
    )
    await assertAccessibleAdministrator(tx, latestConfig)
    return updated
  })

  return apiResponse<UserResponse>({
    ...user,
    roles: (await getUserAccess(user.id)).roles,
  })
})
