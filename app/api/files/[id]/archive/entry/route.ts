import { archiveActor, archiveRoute } from '@/lib/archives/http'
import { withArchiveOperation } from '@/lib/archives/operation'
import { downloadArchiveEntry } from '@/lib/archives/service'
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
        const path = new URL(request.url).searchParams.get('path') ?? ''
        return withArchiveOperation(
          actor.user.id,
          request.signal,
          (operation) => downloadArchiveEntry(actor, id, path, operation)
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
