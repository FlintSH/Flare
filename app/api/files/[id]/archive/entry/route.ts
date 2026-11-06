import { archiveActor, archiveRoutes, entrySelector } from '@/lib/archives/http'
import { readArchiveEntry } from '@/lib/archives/service'
import { setAuditTarget } from '@/lib/audit'
import { routes } from '@/lib/http/route'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/files/[id]/archive/entry', archiveRoutes)

export const GET = api(
  async (request, { params }: Context) => {
    const { id } = await params
    setAuditTarget({ type: 'file', id })
    const actor = await archiveActor(request, ['files.read'])
    const query = new URL(request.url).searchParams
    return readArchiveEntry(
      actor,
      id,
      entrySelector(query),
      request,
      query.get('disposition') === 'inline'
    )
  },
  { audit: { action: 'archive.entry.read', category: 'archives' } }
)
