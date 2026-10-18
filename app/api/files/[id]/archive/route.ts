import {
  archiveActor,
  archiveRoute,
  parseListingQuery,
} from '@/lib/archives/http'
import { listArchive } from '@/lib/archives/service'
import { setAuditTarget, withAuditRoute } from '@/lib/audit'

export const runtime = 'nodejs'
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuditRoute(
    async () => {
      const { id } = await params
      setAuditTarget({ type: 'file', id })
      return archiveRoute(async () => {
        const actor = await archiveActor(request, ['files.read'])
        const query = new URL(request.url).searchParams
        return listArchive(actor, id, {
          ...parseListingQuery({
            progress: query.get('progress') ?? undefined,
            after: query.get('after') ?? undefined,
          }),
          signal: request.signal,
        })
      })
    },
    {
      action: 'archive.browse',
      category: 'archives',
      route: '/api/files/[id]/archive',
    }
  )(request)
}
