import {
  archiveActor,
  archiveBody,
  archiveRoute,
  createArchiveSchema,
} from '@/lib/archives/http'
import { withArchiveOperation } from '@/lib/archives/operation'
import { createAccountArchive } from '@/lib/archives/service'
import { withAuditRoute } from '@/lib/audit'

export const runtime = 'nodejs'
export async function POST(request: Request) {
  return withAuditRoute(
    async () => {
      return archiveRoute(async () => {
        const actor = await archiveActor(request, [
          'files.read',
          'files.upload',
        ])
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
      })
    },
    {
      action: 'archive.create',
      category: 'archives',
      route: '/api/files/archive',
    }
  )(request)
}
