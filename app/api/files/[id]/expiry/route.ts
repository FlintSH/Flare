import { ExpiryAction } from '@/types/events'

import { prisma } from '@/lib/database/prisma'
import {
  cancelFileExpiration,
  getFilesExpirationInfo,
  isExpiryAction,
  scheduleFileExpiration,
} from '@/lib/files/expiry'
import { requireAccount } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { EXPIRY_EFFECTS, allows } from '@/lib/permissions/actions'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/files/[id]/expiry', {
  envelope: 'api',
  failure: { message: 'Failed to get file expiry' },
  logger: loggers.files,
})

export const GET = api(async (request, { params }: Context) => {
  const user = await requireAccount(request)

  const { id } = await params

  const file = await prisma.file.findUnique({
    where: { id },
    select: { userId: true },
  })

  if (!file || file.userId !== user.id) {
    throw new HttpError(404, 'File not found')
  }

  const expiresAt = (await getFilesExpirationInfo([id])).get(id) ?? null

  return apiResponse({ expiresAt })
})

export const POST = api(
  async (request, { params }: Context) => {
    const user = await requireAccount(request)

    const { id } = await params
    const { expiresAt, action = ExpiryAction.DELETE } = (await readJson(
      request
    )) as { expiresAt?: string; action?: unknown }

    if (!expiresAt) {
      throw new HttpError(400, 'Expiration date is required')
    }

    const expirationDate = new Date(expiresAt)
    if (isNaN(expirationDate.getTime()) || expirationDate <= new Date()) {
      throw new HttpError(
        400,
        'Invalid expiration date. Must be in the future.'
      )
    }

    const file = await prisma.file.findUnique({
      where: { id },
      select: { userId: true },
    })

    if (!file || file.userId !== user.id) {
      throw new HttpError(404, 'File not found')
    }

    if (!isExpiryAction(action))
      throw new HttpError(400, 'Invalid expiration action')

    if (!allows(user, EXPIRY_EFFECTS[action]))
      throw new HttpError(
        403,
        'You do not have permission for this expiration action.'
      )

    await scheduleFileExpiration(id, user.id, expirationDate, action)

    return apiResponse({
      message: 'File expiration scheduled successfully',
      expiresAt: expirationDate,
    })
  },
  { failure: { message: 'Failed to schedule file expiry' } }
)

export const DELETE = api(
  async (request, { params }: Context) => {
    const user = await requireAccount(request)

    const { id } = await params

    const file = await prisma.file.findUnique({
      where: { id },
      select: { userId: true },
    })

    if (!file || file.userId !== user.id) {
      throw new HttpError(404, 'File not found')
    }

    const cancelled = await cancelFileExpiration(id, user.id)

    return apiResponse({
      message: cancelled ? 'File expiration cancelled' : 'No expiration found',
      cancelled,
    })
  },
  { failure: { message: 'Failed to cancel file expiry' } }
)
