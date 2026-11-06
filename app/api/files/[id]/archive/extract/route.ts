import {
  archiveActor,
  archiveBody,
  archiveRoutes,
  extractArchiveSchema,
} from '@/lib/archives/http'
import { withArchiveOperation } from '@/lib/archives/operation'
import { extractArchive } from '@/lib/archives/service'
import { setAuditTarget } from '@/lib/audit'
import { routes } from '@/lib/http/route'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/files/[id]/archive/extract', archiveRoutes)

export const POST = api(
  async (request, { params }: Context) => {
    const { id } = await params
    setAuditTarget({ type: 'file', id })
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
  },
  { audit: { action: 'archive.extract', category: 'archives' } }
)
