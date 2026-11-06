import { requireAccount } from '@/lib/http/access'
import { routes } from '@/lib/http/route'
import { deleteOwnShortLink } from '@/lib/links/service'
import { loggers } from '@/lib/logger'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/urls/[id]', {
  envelope: 'api',
  failure: { message: 'Internal server error' },
  logger: loggers.api,
})

export const DELETE = api(async (request, { params }: Context) => {
  const user = await requireAccount(request)
  const { id } = await params
  await deleteOwnShortLink(user.id, id)
  return new Response(null, { status: 204 })
})
