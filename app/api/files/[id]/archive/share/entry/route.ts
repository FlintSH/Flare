import { archiveRoute, entrySelector } from '@/lib/archives/http'
import { readSharedArchiveEntry } from '@/lib/archives/service'
import {
  authorizeSharedArchive,
  sharedArchiveBody,
  sharedArchiveEntrySchema,
  sharedArchiveGuard,
} from '@/lib/archives/sharing'
import { readArchiveUnlock } from '@/lib/archives/unlock'
import { setAuditTarget, withAuditRoute } from '@/lib/audit'
import { getClientIp } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

const audit = {
  action: 'archive.entry.read',
  category: 'archives',
  route: '/api/files/[id]/archive/share/entry',
}

/** Previews and links: access comes from the session or an unlock cookie. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuditRoute(async () => {
    const { id } = await params
    setAuditTarget({ type: 'file', id })
    return archiveRoute(async () => {
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
    })
  }, audit)(request)
}

/** Form or JSON download with the file password in the body. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuditRoute(async () => {
    const { id } = await params
    setAuditTarget({ type: 'file', id })
    return archiveRoute(async () => {
      const limited = await sharedArchiveGuard(request, 'entry')
      if (limited) return limited
      const input = sharedArchiveEntrySchema.parse(
        await sharedArchiveBody(request, true)
      )
      const access = await authorizeSharedArchive(
        id,
        input.password,
        readArchiveUnlock(request)
      )
      return readSharedArchiveEntry(access, { path: input.path }, request, {
        inline: false,
        requester: `ip:${getClientIp(request)}`,
      })
    })
  }, audit)(request)
}
