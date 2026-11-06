import { requireSession } from '@/lib/http/access'
import { routes } from '@/lib/http/route'
import { listAccountShortLinks } from '@/lib/links/service'
import { loggers } from '@/lib/logger'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/users/[id]/urls', {
  failure: { message: 'Internal Server Error' },
  logger: loggers.users,
})

export const GET = api(async (request, { params }: Context) => {
  await requireSession('content.read')
  const { id } = await params
  const query = new URL(request.url).searchParams
  return listAccountShortLinks(id, {
    page: Number(query.get('page')),
    limit: Number(query.get('limit')),
    search: query.get('search') || '',
  })
})
