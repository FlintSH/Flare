import { prisma } from '@/lib/database/prisma'
import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { assertSameOrigin } from '@/lib/http/request'
import { routes } from '@/lib/http/route'

type Context = { params: Promise<{ id: string; urlId: string }> }

const api = routes('/api/users/[id]/urls/[urlId]', {
  envelope: 'api',
  failure: { message: 'Internal server error' },
})

/** Moderation stays session-only; named tokens can delete only their owner's links. */
export const DELETE = api(async (request, { params }: Context) => {
  await requireSession('content.delete')
  assertSameOrigin(request)
  const { id, urlId } = await params
  const result = await prisma.shortenedUrl.deleteMany({
    where: { id: urlId, userId: id },
  })
  if (!result.count) throw new HttpError(404, 'URL not found')
  return new Response(null, { status: 204 })
})
