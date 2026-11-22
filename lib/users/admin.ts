import type { PaginationMeta } from '@/types/dto/api-responses'
import type { UserResponse } from '@/types/dto/user'
import type { Prisma, Role } from '@prisma/client'

import { lockRoleChanges } from '@/lib/database/locks'
import { prisma } from '@/lib/database/prisma'
import { getEmailConfigForUpdate } from '@/lib/email/config'
import { HttpError } from '@/lib/http/errors'
import { pageWindow } from '@/lib/http/pagination'
import { ADMIN_PERMISSIONS } from '@/lib/permissions/admin-actions'
import type { Permission } from '@/lib/permissions/catalog'
import { EVERYONE_ROLE } from '@/lib/permissions/policy'
import {
  assertAccessibleAdministrator,
  assertCanManageUser,
  getUserAccess,
  requireActorPermission,
  validateRoleAssignment,
} from '@/lib/permissions/server'

import { createAccount } from './create-account'
import { hashAccountPassword } from './credentials'
import { updateAccount } from './update-account'

// User administration for the Users page's routes and the MCP tools. Callers
// check the session's permission from ADMIN_PERMISSIONS first; each write
// checks the acting account again under the role lock.

/** A page of the user directory. Missing values get the route's defaults. */
export interface UserListQuery {
  /** Matches a name or email in any letter case; trimmed, at most 200 characters. */
  search?: string | null
  /** Accounts holding this role. Everyone's role, or none, lists every account. */
  roleId?: string | null
  /** A value that isn't a positive integer means the first page. */
  page?: number
  /** At most 100; a value that isn't a positive integer means 25. */
  limit?: number
}

/** The directory query as the Users page sends it in a URL. */
export function userListQuery(searchParams: URLSearchParams): UserListQuery {
  return {
    search: searchParams.get('search'),
    roleId: searchParams.get('roleId'),
    page: Number(searchParams.get('page')),
    limit: Number(searchParams.get('limit')),
  }
}

/** Accounts newest first, each with its roles, Everyone last, and who invited it. */
export async function listUsers(
  query: UserListQuery
): Promise<{ data: UserResponse[]; pagination: PaginationMeta }> {
  const search = (query.search || '').trim().slice(0, 200)
  const { roleId } = query
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
    { page: query.page ?? 0, limit: query.limit ?? 0 },
    { defaultLimit: 25, maxLimit: 100 }
  )

  const users = await prisma.user.findMany({
    where,
    select: userRowSelect,
    orderBy: {
      createdAt: 'desc',
    },
    skip,
    take: limit,
  })

  return {
    data: users.map((user) => userRow(user, everyone)),
    pagination: { total, pageCount: pages, page, limit },
  }
}

const userRowSelect = {
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
} as const satisfies Prisma.UserSelect

function userRow(
  { invite, ...user }: Prisma.UserGetPayload<{ select: typeof userRowSelect }>,
  everyone: Role | null
): UserResponse {
  return {
    ...user,
    roles: [
      ...user.roles.filter((role) => role.id !== everyone?.id),
      ...(everyone ? [everyone] : []),
    ],
    invitedBy: invite?.creator ?? null,
  }
}

/** One account as the user directory lists it, or null. */
export async function findUserRow(id: string): Promise<UserResponse | null> {
  const [user, everyone] = await Promise.all([
    prisma.user.findUnique({ where: { id }, select: userRowSelect }),
    prisma.role.findUnique({ where: { systemKey: EVERYONE_ROLE } }),
  ])
  return user && userRow(user, everyone)
}

/** What a lookup of one account answers. */
export const userSummarySelect = {
  id: true,
  name: true,
  email: true,
  image: true,
  roles: true,
} as const satisfies Prisma.UserSelect

/** One account by its id or email, or null. */
export function findUserSummary(where: Prisma.UserWhereUniqueInput) {
  return prisma.user.findUnique({ where, select: userSummarySelect })
}

export interface NewUser {
  email: string
  name: string
  /**
   * The password as typed, hashed here. Without one the account has no
   * password: it can't sign in until an administrator sets one.
   */
  password?: string
  /** Needs `users.roles`, and every role must be one the actor may grant. */
  roleIds?: string[]
}

/**
 * A caller's own last check before an account is created or changed, run
 * under the role lock once the service's own checks have passed, in the
 * transaction that writes. Throw to refuse.
 */
export type UserAdminCheck = (tx: Prisma.TransactionClient) => Promise<void>

/** Creates an account as an administrator, with the email settings' rule for admin-created addresses. */
export async function createUser(
  actorId: string,
  input: NewUser,
  check?: UserAdminCheck
): Promise<UserResponse> {
  const exists = await prisma.user.findUnique({
    where: { email: input.email },
  })

  if (exists) {
    throw new HttpError(400, 'User already exists')
  }

  const hashedPassword = input.password
    ? await hashAccountPassword(input.password)
    : undefined

  const user = await prisma.$transaction(async (tx) => {
    await lockRoleChanges(tx)
    await requireActorPermission(tx, actorId, 'users.create')
    if (input.roleIds?.length) {
      await requireActorPermission(tx, actorId, 'users.roles')
      await validateRoleAssignment(tx, actorId, null, input.roleIds)
    }
    await check?.(tx)
    const emailConfig = await getEmailConfigForUpdate(tx)
    const created = await createAccount(
      tx,
      {
        email: input.email,
        name: input.name,
        password: hashedPassword,
        roleIds: input.roleIds,
        emailExempt: emailConfig.verification.adminCreated === 'exempt',
      },
      { verifyWith: emailConfig }
    )
    if (!created) throw new HttpError(400, 'Email already exists')
    return created
  })

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    roles: (await getUserAccess(user.id)).roles,
    urlId: user.urlId,
    vanityId: user.vanityId,
    storageUsed: user.storageUsed,
    _count: { files: 0, shortenedUrls: 0 },
  }
}

/** Fields left undefined keep their values. */
export interface UserEdit {
  id: string
  name?: string
  email?: string
  /** A new password as typed, hashed here. */
  password?: string
  urlId?: string
  /** Null removes the vanity ID. */
  vanityId?: string | null
  /** The complete set of roles; the same set as now changes nothing. */
  roleIds?: string[]
}

/**
 * What a user edit needs: `users.update` when it names any field besides
 * `id` and `roleIds`, otherwise `users.roles`.
 */
export function userUpdatePermission(fields: Iterable<string>): Permission {
  for (const field of fields)
    if (field !== 'id' && field !== 'roleIds')
      return ADMIN_PERMISSIONS.updateUser[0]
  return ADMIN_PERMISSIONS.assignUserRoles[0]
}

/** Saves an administrator's edit to another account. */
export async function updateUser(
  actorId: string,
  input: UserEdit,
  check?: UserAdminCheck
): Promise<UserResponse> {
  const requiredPermission = userUpdatePermission(
    Object.entries(input)
      .filter(([, value]) => value !== undefined)
      .map(([field]) => field)
  )
  const existingUser = await prisma.user.findUnique({
    where: { id: input.id },
  })

  if (!existingUser) {
    throw new HttpError(404, 'User not found')
  }

  const passwordHash = input.password
    ? await hashAccountPassword(input.password)
    : undefined

  const user = await prisma.$transaction(async (tx) => {
    await lockRoleChanges(tx)
    await requireActorPermission(tx, actorId, requiredPermission)
    await assertCanManageUser(tx, actorId, existingUser.id)
    await check?.(tx)
    const latestConfig = await getEmailConfigForUpdate(tx)
    const { roleIds } = input
    const updated = await updateAccount(
      tx,
      existingUser,
      {
        name: input.name,
        email: input.email,
        password: passwordHash,
        urlId: input.urlId,
        vanityId: input.vanityId,
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
              await requireActorPermission(tx, actorId, 'users.roles')
              await validateRoleAssignment(tx, actorId, account.id, roleIds)
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

  return {
    ...user,
    roles: (await getUserAccess(user.id)).roles,
  }
}
