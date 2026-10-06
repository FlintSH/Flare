import { archiveRoute } from '@/lib/archives/http'
import { withArchiveOperation } from '@/lib/archives/operation'
import { listSharedArchive } from '@/lib/archives/service'
import {
  authorizeSharedArchive,
  sharedArchiveBody,
  sharedArchiveGuard,
  sharedArchiveSchema,
} from '@/lib/archives/sharing'
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
        const limited = await sharedArchiveGuard(request)
        if (limited) return limited
        const input = sharedArchiveSchema.parse(
          await sharedArchiveBody(request)
        )
        const access = await authorizeSharedArchive(id, input.password)
        return withArchiveOperation(
          `share:${id}`,
          request.signal,
          (operation) => listSharedArchive(access, operation)
        )
      })
    },
    {
      action: 'archive.browse',
      category: 'archives',
      route: '/api/files/[id]/archive/share',
    }
  )(request)
}
