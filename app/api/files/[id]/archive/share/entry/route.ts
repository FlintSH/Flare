import { archiveRoute } from '@/lib/archives/http'
import { withArchiveOperation } from '@/lib/archives/operation'
import { downloadSharedArchiveEntry } from '@/lib/archives/service'
import {
  authorizeSharedArchive,
  sharedArchiveBody,
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
    const input = sharedArchiveEntrySchema.parse(
      await sharedArchiveBody(request, true)
    )
    const access = await authorizeSharedArchive(id, input.password)
    return withArchiveOperation(`share:${id}`, request.signal, (operation) =>
      downloadSharedArchiveEntry(access, input.path, operation)
    )
  })
}
