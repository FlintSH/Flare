import { archiveActor, archiveRoute, entrySelector } from '@/lib/archives/http'
import { readArchiveEntry } from '@/lib/archives/service'
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
        return readArchiveEntry(
          actor,
          id,
          entrySelector(query),
          request,
          query.get('disposition') === 'inline'
        )
      })
    },
    {
      action: 'archive.entry.read',
      category: 'archives',
      route: '/api/files/[id]/archive/entry',
    }
  )(request)
}
