import {
  cancelFileExpiration,
  pendingExpiration,
  scheduleFileExpiration,
} from '@/lib/files/expiry'
import { requireAccount } from '@/lib/http/access'
import { readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/files/[id]/expiry', {
  envelope: 'api',
  failure: { message: 'Failed to get file expiry' },
  logger: loggers.files,
})

export const GET = api(async (request, { params }: Context) => {
  const user = await requireAccount(request)
  const { id } = await params
  return apiResponse({ expiresAt: await pendingExpiration(user.id, id) })
})

export const POST = api(
  async (request, { params }: Context) => {
    const user = await requireAccount(request)
    const { id } = await params
    const expiresAt = await scheduleFileExpiration(
      user,
      id,
      await readJson(request)
    )
    return apiResponse({
      message: 'File expiration scheduled successfully',
      expiresAt,
    })
  },
  { failure: { message: 'Failed to schedule file expiry' } }
)

export const DELETE = api(
  async (request, { params }: Context) => {
    const user = await requireAccount(request)
    const { id } = await params
    const cancelled = await cancelFileExpiration(user.id, id)
    return apiResponse({
      message: cancelled ? 'File expiration cancelled' : 'No expiration found',
      cancelled,
    })
  },
  { failure: { message: 'Failed to cancel file expiry' } }
)
