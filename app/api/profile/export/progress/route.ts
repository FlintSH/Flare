import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { routes } from '@/lib/http/route'
import { requestedExportId } from '@/lib/users/export-id'
import { exportProgressEvents } from '@/lib/users/export-progress'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const api = routes('/api/profile/export/progress', {
  failure: { message: 'Internal server error' },
})

export const GET = api(async (request) => {
  const { user } = await requireSession(request, 'profile.export')
  const exportId = requestedExportId(request)
  if (!exportId) throw new HttpError(400, 'Missing export id.')

  return new Response(exportProgressEvents(user.id, exportId, request.signal), {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
})
