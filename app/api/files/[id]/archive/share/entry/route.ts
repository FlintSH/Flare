import { archiveBody, archiveRoute } from '@/lib/archives/http'
import { withArchiveOperation } from '@/lib/archives/operation'
import { downloadSharedArchiveEntry } from '@/lib/archives/service'
import {
  sharedArchiveEntrySchema,
  sharedArchiveGuard,
} from '@/lib/archives/sharing'

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
        const input = sharedArchiveEntrySchema.parse(
          await archiveBody(request, operation.signal, true)
        )
        return downloadSharedArchiveEntry(
          id,
          input.path,
          input.password,
          operation
        )
      }
    )
  })
}
