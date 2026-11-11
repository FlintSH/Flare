import { assertPermission, requireSession } from '@/lib/http/access'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { exportManifest } from '@/lib/users/export'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const api = routes('/api/profile/export/manifest', {
  failure: { message: 'Internal server error' },
  logger: loggers.users,
})

/**
 * The list a browser builds the account export from when the account has
 * encrypted files (docs/e2ee-spec.md, section 12.4). A browser session
 * only, with the permissions of the export itself. No bearer token reads
 * it: only a browser has keys to decrypt with.
 */
export const GET = api(async (request) => {
  const { user } = await requireSession(request, 'profile.export')
  assertPermission(user, 'files.read')
  assertPermission(user, 'links.read')
  return Response.json(
    { data: await exportManifest(user.id) },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})
