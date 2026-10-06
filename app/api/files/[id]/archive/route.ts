import { archiveActor, archiveRoute } from '@/lib/archives/http'
import { withArchiveOperation } from '@/lib/archives/operation'
import { listArchive } from '@/lib/archives/service'

export const runtime = 'nodejs'
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return archiveRoute(async () => {
    const actor = await archiveActor(request, ['files.read'])
    const { id } = await params
    return withArchiveOperation(actor.user.id, request.signal, (operation) =>
      listArchive(actor, id, operation)
    )
  })
}
