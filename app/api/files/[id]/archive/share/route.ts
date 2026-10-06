import { archiveRoute } from '@/lib/archives/http'
import { withArchiveOperation } from '@/lib/archives/operation'
import { listSharedArchive } from '@/lib/archives/service'
import {
  authorizeSharedArchive,
  sharedArchiveBody,
  sharedArchiveGuard,
  sharedArchiveSchema,
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
    const input = sharedArchiveSchema.parse(await sharedArchiveBody(request))
    const access = await authorizeSharedArchive(id, input.password)
    return withArchiveOperation(`share:${id}`, request.signal, (operation) =>
      listSharedArchive(access, operation)
    )
  })
}
