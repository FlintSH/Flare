import {
  ARCHIVE_BODY_LIMIT,
  archiveActor,
  archiveRoutes,
  createArchiveSchema,
} from '@/lib/archives/http'
import { withArchiveOperation } from '@/lib/archives/operation'
import { createAccountArchive } from '@/lib/archives/service'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { actionPermissions } from '@/lib/permissions/actions'

const api = routes('/api/files/archive', archiveRoutes)

export const POST = api(
  async (request) => {
    const actor = await archiveActor(
      request,
      actionPermissions('createArchive')
    )
    return withArchiveOperation(
      actor.user.id,
      request.signal,
      async (operation) => {
        const input = createArchiveSchema.parse(
          await readJson(request, {
            limit: ARCHIVE_BODY_LIMIT,
            signal: operation.signal,
          })
        )
        return createAccountArchive(actor, input, operation)
      }
    )
  },
  { audit: { action: 'archive.create', category: 'archives' } }
)
