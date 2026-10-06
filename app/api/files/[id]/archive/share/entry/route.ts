import { archiveRoute } from '@/lib/archives/http'
import { withArchiveOperation } from '@/lib/archives/operation'
import { downloadSharedArchiveEntry } from '@/lib/archives/service'
import {
  authorizeSharedArchive,
  sharedArchiveBody,
  sharedArchiveEntrySchema,
  sharedArchiveGuard,
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
        const input = sharedArchiveEntrySchema.parse(
          await sharedArchiveBody(request, true)
        )
        const access = await authorizeSharedArchive(id, input.password)
        return withArchiveOperation(
          `share:${id}`,
          request.signal,
          (operation) =>
            downloadSharedArchiveEntry(access, input.path, operation)
        )
      })
    },
    {
      action: 'archive.entry.read',
      category: 'archives',
      route: '/api/files/[id]/archive/share/entry',
    }
  )(request)
}
