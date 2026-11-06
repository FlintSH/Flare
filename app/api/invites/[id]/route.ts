import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { routes } from '@/lib/http/route'
import { revokeInvite } from '@/lib/invites/service'
import { generalLimiter, rateLimit } from '@/lib/security/rate-limit'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/invites/[id]', {
  failure: { message: 'Could not revoke the invite' },
})

export const DELETE = api(async (request, { params }: Context) => {
  const limited = await rateLimit(request, generalLimiter)
  if (limited) return limited
  const { user } = await requireSession(request, [
    'invites.create',
    'invites.manage',
  ])
  const { id } = await params
  if (!id || id.length > 128) throw new HttpError(404, 'Invite not found')
  return { invite: await revokeInvite(user.id, id) }
})
