import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { assertJsonMutation } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { revokeInvite } from '@/lib/invites/service'
import { generalLimiter, rateLimit } from '@/lib/security/rate-limit'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/invites/[id]', {
  headers: { 'Cache-Control': 'private, no-store' },
  failure: { message: 'Could not revoke the invite' },
})

export const DELETE = api(async (request, { params }: Context) => {
  const limited = await rateLimit(request, generalLimiter)
  if (limited) return limited
  const { user } = await requireSession(['invites.create', 'invites.manage'])
  assertJsonMutation(request, { body: false })
  const { id } = await params
  if (!id || id.length > 128) throw new HttpError(404, 'Invite not found')
  return { invite: await revokeInvite(user.id, id) }
})
