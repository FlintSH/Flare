import {
  archiveActor,
  archiveBody,
  archiveRoute,
  extractArchiveSchema,
} from '@/lib/archives/http'
import { withArchiveOperation } from '@/lib/archives/operation'
import { extractArchive } from '@/lib/archives/service'

export const runtime = 'nodejs'
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return archiveRoute(async () => {
    const actor = await archiveActor(request, [
      'files.read',
      'files.upload',
      'folders.manage',
    ])
    const { id } = await params
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
}
