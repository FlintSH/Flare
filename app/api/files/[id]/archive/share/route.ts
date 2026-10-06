import { archiveBody, archiveRoute } from '@/lib/archives/http'
import { withArchiveOperation } from '@/lib/archives/operation'
import { listSharedArchive } from '@/lib/archives/service'
import { sharedArchiveGuard, sharedArchiveSchema } from '@/lib/archives/sharing'

export const runtime = 'nodejs'
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return archiveRoute(async () => {
    const limited = await sharedArchiveGuard(request)
    if (limited) return limited
    const { id } = await params
    return withArchiveOperation(
      `share:${id}`,
      request.signal,
      async (operation) => {
        const input = sharedArchiveSchema.parse(
          await archiveBody(request, operation.signal)
        )
        return listSharedArchive(id, input.password, operation)
      }
    )
  })
}
