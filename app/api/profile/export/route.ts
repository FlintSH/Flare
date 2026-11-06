import { requireAccount } from '@/lib/http/access'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'
import { exportAccountData } from '@/lib/users/export'
import { requestedExportId } from '@/lib/users/export-id'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const api = routes('/api/profile/export', {
  failure: { message: 'Internal server error' },
  logger: loggers.users,
})

export const GET = api(async (request) => {
  const { id: userId } = await requireAccount(request)
  const { filename, body } = await exportAccountData(userId, {
    exportId: requestedExportId(request),
    signal: request.signal,
  })
  return new Response(body, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  })
})
