import {
  archiveActor,
  archiveRoutes,
  parseListingQuery,
} from '@/lib/archives/http'
import { listArchive } from '@/lib/archives/service'
import { setAuditTarget } from '@/lib/audit'
import { routes } from '@/lib/http/route'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/files/[id]/archive', archiveRoutes)

export const GET = api(
  async (request, { params }: Context) => {
    const { id } = await params
    setAuditTarget({ type: 'file', id })
    const actor = await archiveActor(request, ['files.read'])
    const query = new URL(request.url).searchParams
    return listArchive(actor, id, {
      ...parseListingQuery({
        progress: query.get('progress') ?? undefined,
        after: query.get('after') ?? undefined,
      }),
      signal: request.signal,
    })
  },
  { audit: { action: 'archive.browse', category: 'archives' } }
)
