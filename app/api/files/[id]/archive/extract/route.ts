import {
  archiveActor,
  archiveBody,
  archiveRoute,
  extractArchiveSchema,
} from '@/lib/archives/http'
import { withArchiveOperation } from '@/lib/archives/operation'
import { extractArchive } from '@/lib/archives/service'
import { setAuditTarget, withAuditRoute } from '@/lib/audit'

export const runtime = 'nodejs'
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuditRoute(
    async () => {
      const { id } = await params
      setAuditTarget({ type: 'file', id })
      return archiveRoute(async () => {
        const actor = await archiveActor(request, [
          'files.read',
          'files.upload',
          'folders.manage',
        ])
        return withArchiveOperation(
          actor.user.id,
          request.signal,
          async (operation) => {
            const input = extractArchiveSchema.parse(
              await archiveBody(request, operation.signal)
            )
            return extractArchive(actor, id, input, operation)
          }
        )
      })
    },
    {
      action: 'archive.extract',
      category: 'archives',
      route: '/api/files/[id]/archive/extract',
    }
  )(request)
}
