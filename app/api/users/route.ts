import { UserResponse, UserSchema } from '@/types/dto/user'

import { assertPermission, requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { readJson } from '@/lib/http/request'
import { apiResponse, paginatedResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { ADMIN_PERMISSIONS } from '@/lib/permissions/admin-actions'
import {
  createUser,
  listUsers,
  updateUser,
  userListQuery,
  userUpdatePermission,
} from '@/lib/users/admin'

const api = routes('/api/users', {
  envelope: 'api',
  failure: { message: 'Internal server error' },
  logger: loggers.users,
})

export const GET = api(async (request) => {
  await requireSession(request, ADMIN_PERMISSIONS.listUsers)

  const { data, pagination } = await listUsers(
    userListQuery(new URL(request.url).searchParams)
  )
  return paginatedResponse<UserResponse[]>(data, pagination)
})

export const POST = api(async (request) => {
  const { user: actor } = await requireSession(
    request,
    ADMIN_PERMISSIONS.createUser
  )

  const json = await readJson(request)
  if (!json || typeof json !== 'object' || Array.isArray(json))
    throw new HttpError(400, 'Provide a JSON object')

  const result = UserSchema.safeParse(json)
  if (!result.success) {
    throw new HttpError(400, result.error.issues[0].message)
  }

  return apiResponse<UserResponse>(await createUser(actor.id, result.data))
})

export const PUT = api(async (request) => {
  const { user: actor } = await requireSession(request)
  const json = await readJson(request)
  if (!json || typeof json !== 'object' || Array.isArray(json))
    throw new HttpError(400, 'Provide a JSON object')
  assertPermission(actor, userUpdatePermission(Object.keys(json)))

  const result = UserSchema.partial().safeParse(json)
  if (!result.success) {
    throw new HttpError(400, result.error.issues[0].message)
  }

  const body = result.data

  if (!body.id) {
    throw new HttpError(400, 'User ID is required')
  }

  return apiResponse<UserResponse>(
    await updateUser(actor.id, { ...body, id: body.id })
  )
})
