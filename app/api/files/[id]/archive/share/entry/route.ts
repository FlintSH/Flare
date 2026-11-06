import { archiveRoutes, entrySelector } from '@/lib/archives/http'
import { readSharedArchiveEntry } from '@/lib/archives/service'
import {
  authorizeSharedArchive,
  sharedArchiveBody,
  sharedArchiveEntrySchema,
  sharedArchiveGuard,
} from '@/lib/archives/sharing'
import { readArchiveUnlock } from '@/lib/archives/unlock'
import { setAuditTarget } from '@/lib/audit'
import { requestIp } from '@/lib/auth/security/shared'
import { routes } from '@/lib/http/route'
import { getClientIp } from '@/lib/security/rate-limit'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/files/[id]/archive/share/entry', archiveRoutes)

const audit = { action: 'archive.entry.read', category: 'archives' }

/** Previews and links: access comes from the session or an unlock cookie. */
export const GET = api(
  async (request, { params }: Context) => {
    const { id } = await params
    setAuditTarget({ type: 'file', id })
    const limited = await sharedArchiveGuard(request, 'entry')
    if (limited) return limited
    const query = new URL(request.url).searchParams
    const access = await authorizeSharedArchive(
      id,
      undefined,
      readArchiveUnlock(request)
    )
    return readSharedArchiveEntry(access, entrySelector(query), request, {
      inline: query.get('disposition') === 'inline',
      requester: `ip:${getClientIp(request)}`,
    })
  },
  { audit }
)

/** Form or JSON download with the file password in the body. */
export const POST = api(
  async (request, { params }: Context) => {
    const { id } = await params
    setAuditTarget({ type: 'file', id })
    const limited = await sharedArchiveGuard(request, 'entry')
    if (limited) return limited
    const input = sharedArchiveEntrySchema.parse(
      await sharedArchiveBody(request, true)
    )
    const access = await authorizeSharedArchive(
      id,
      input.password,
      readArchiveUnlock(request),
      requestIp(request.headers)
    )
    return readSharedArchiveEntry(access, { path: input.path }, request, {
      inline: false,
      requester: `ip:${getClientIp(request)}`,
    })
  },
  { audit }
)
