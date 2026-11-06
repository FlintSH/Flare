import { ExpiryAction } from '@/types/events'

import { prisma } from '@/lib/database/prisma'
import {
  cancelFileExpiration,
  getFileExpirationInfo,
  scheduleFileExpiration,
} from '@/lib/events/handlers/file-expiry'
import { requireAccount } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { hasPermission } from '@/lib/permissions/catalog'

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
    select: { userId: true, name: true },
  })

  if (!file || file.userId !== user.id) {
    throw new HttpError(404, 'File not found')
  }

  const expiresAt = await getFileExpirationInfo(id)

  return apiResponse({ expiresAt })
})

export const POST = api(
  async (request, { params }: Context) => {
    const user = await requireAccount(request)

    const { id } = await params
    const { expiresAt, action = ExpiryAction.DELETE } = (await readJson(
      request
    )) as { expiresAt?: string; action?: ExpiryAction }

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
      select: { userId: true, name: true },
    })

    if (!file || file.userId !== user.id) {
      throw new HttpError(404, 'File not found')
    }

    if (![ExpiryAction.DELETE, ExpiryAction.SET_PRIVATE].includes(action))
      throw new HttpError(400, 'Invalid expiration action')

    const actionPermission =
      action === ExpiryAction.DELETE ? 'files.delete' : 'files.share'
    if (!hasPermission(user, actionPermission))
      throw new HttpError(
        403,
        'You do not have permission for this expiration action.'
      )

    await scheduleFileExpiration(id, user.id, file.name, expirationDate, action)

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

    const cancelled = await cancelFileExpiration(id)

    return apiResponse({
      message: cancelled ? 'File expiration cancelled' : 'No expiration found',
      cancelled,
    })
  },
  { failure: { message: 'Failed to cancel file expiry' } }
)
