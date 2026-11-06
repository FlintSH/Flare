import { requireSession } from '@/lib/http/access'
import { routes } from '@/lib/http/route'
import { deleteAccountShortLink } from '@/lib/links/service'

type Context = { params: Promise<{ id: string; urlId: string }> }

const api = routes('/api/users/[id]/urls/[urlId]', {
  envelope: 'api',
  failure: { message: 'Internal server error' },
})

/** Moderation stays session-only; named tokens can delete only their owner's links. */
export const DELETE = api(async (request, { params }: Context) => {
  await requireSession(request, 'content.delete')
  const { id, urlId } = await params
  await deleteAccountShortLink(id, urlId)
  return new Response(null, { status: 204 })
})
