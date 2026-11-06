import {
  archiveActor,
  archiveBody,
  archiveRoutes,
  createArchiveSchema,
} from '@/lib/archives/http'
import { withArchiveOperation } from '@/lib/archives/operation'
import { createAccountArchive } from '@/lib/archives/service'
import { routes } from '@/lib/http/route'

const api = routes('/api/files/archive', archiveRoutes)

export const POST = api(
  async (request) => {
    const actor = await archiveActor(request, ['files.read', 'files.upload'])
    return withArchiveOperation(
      actor.user.id,
      request.signal,
      async (operation) => {
        const input = createArchiveSchema.parse(
          await archiveBody(request, operation.signal)
        )
        return createAccountArchive(actor, input, operation)
      }
    )
  },
  { audit: { action: 'archive.create', category: 'archives' } }
)
