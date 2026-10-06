import { archiveActor, archiveRoute } from '@/lib/archives/http'
import { withArchiveOperation } from '@/lib/archives/operation'
import { downloadArchiveEntry } from '@/lib/archives/service'

export const runtime = 'nodejs'
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return archiveRoute(async () => {
    const actor = await archiveActor(request, ['files.read'])
    const { id } = await params
    const path = new URL(request.url).searchParams.get('path') ?? ''
    return withArchiveOperation(actor.user.id, request.signal, (operation) =>
      downloadArchiveEntry(actor, id, path, operation)
    )
  })
}
