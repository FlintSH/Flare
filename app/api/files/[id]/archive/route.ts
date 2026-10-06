import { archiveActor, archiveRoute } from '@/lib/archives/http'
import { withArchiveOperation } from '@/lib/archives/operation'
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
        return withArchiveOperation(
          actor.user.id,
          request.signal,
          (operation) => listArchive(actor, id, operation)
        )
      })
    },
    {
      action: 'archive.browse',
      category: 'archives',
      route: '/api/files/[id]/archive',
    }
  )(request)
}
