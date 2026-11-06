import { listAccountFiles } from '@/lib/files/manage'
import { requireSession } from '@/lib/http/access'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/users/[id]/files', {
  failure: { message: 'Internal Server Error' },
  logger: loggers.files,
})

export const GET = api(async (request, { params }: Context) => {
  await requireSession('content.read')
  const query = new URL(request.url).searchParams
  const { id } = await params
  return listAccountFiles(id, {
    page: Number(query.get('page')),
    limit: Number(query.get('limit')),
    search: query.get('search') || '',
    visibility: query.get('visibility') || '',
    type: query.get('type') || '',
  })
})
