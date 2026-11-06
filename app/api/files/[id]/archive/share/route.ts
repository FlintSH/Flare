import { archiveRoutes, parseListingQuery } from '@/lib/archives/http'
import { listSharedArchive } from '@/lib/archives/service'
import {
  authorizeSharedArchive,
  sharedArchiveBody,
  sharedArchiveGuard,
  sharedArchiveSchema,
  withArchiveUnlock,
} from '@/lib/archives/sharing'
import { readArchiveUnlock } from '@/lib/archives/unlock'
import { setAuditTarget } from '@/lib/audit'
import { parseInput } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { clientIp } from '@/lib/security/client-ip'
import { requesterKey } from '@/lib/security/rate-limit'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/files/[id]/archive/share', archiveRoutes)

export const POST = api(
  async (request, { params }: Context) => {
    const { id } = await params
    setAuditTarget({ type: 'file', id })
    const limited = await sharedArchiveGuard(request, 'listing')
    if (limited) return limited
    const input = parseInput(
      sharedArchiveSchema,
      await sharedArchiveBody(request)
    )
    const access = await authorizeSharedArchive(
      id,
      input.password,
      readArchiveUnlock(request),
      clientIp(request.headers)
    )
    const response = await listSharedArchive(access, {
      ...parseListingQuery(input),
      signal: request.signal,
      requester: requesterKey(request),
    })
    return withArchiveUnlock(response, access, request)
  },
  { audit: { action: 'archive.browse', category: 'archives' } }
)
