import { archiveRoute, parseListingQuery } from '@/lib/archives/http'
import { listSharedArchive } from '@/lib/archives/service'
import {
  authorizeSharedArchive,
  sharedArchiveBody,
  sharedArchiveGuard,
  sharedArchiveSchema,
  withArchiveUnlock,
} from '@/lib/archives/sharing'
import { readArchiveUnlock } from '@/lib/archives/unlock'
import { setAuditTarget, withAuditRoute } from '@/lib/audit'
import { getClientIp } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuditRoute(
    async () => {
      const { id } = await params
      setAuditTarget({ type: 'file', id })
      return archiveRoute(async () => {
        const limited = await sharedArchiveGuard(request, 'listing')
        if (limited) return limited
        const input = sharedArchiveSchema.parse(
          await sharedArchiveBody(request)
        )
        const access = await authorizeSharedArchive(
          id,
          input.password,
          readArchiveUnlock(request)
        )
        const response = await listSharedArchive(access, {
          ...parseListingQuery(input),
          signal: request.signal,
          requester: `ip:${getClientIp(request)}`,
        })
        return withArchiveUnlock(response, access, request)
      })
    },
    {
      action: 'archive.browse',
      category: 'archives',
      route: '/api/files/[id]/archive/share',
    }
  )(request)
}
