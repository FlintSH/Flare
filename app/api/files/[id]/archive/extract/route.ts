import {
  ARCHIVE_BODY_LIMIT,
  archiveActor,
  archiveRoutes,
  extractArchiveSchema,
} from '@/lib/archives/http'
import { withArchiveOperation } from '@/lib/archives/operation'
import { extractArchive } from '@/lib/archives/service'
import { setAuditTarget } from '@/lib/audit'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { actionPermissions } from '@/lib/permissions/actions'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/files/[id]/archive/extract', archiveRoutes)

export const POST = api(
  async (request, { params }: Context) => {
    const { id } = await params
    setAuditTarget({ type: 'file', id })
    const actor = await archiveActor(
      request,
      actionPermissions('extractArchive')
    )
    return withArchiveOperation(
      actor.user.id,
      request.signal,
      async (operation) => {
        const input = extractArchiveSchema.parse(
          await readJson(request, {
            limit: ARCHIVE_BODY_LIMIT,
            signal: operation.signal,
          })
        )
        return extractArchive(actor, id, input, operation)
      }
    )
  },
  { audit: { action: 'archive.extract', category: 'archives' } }
)
