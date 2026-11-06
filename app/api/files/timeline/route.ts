import { fileTimeline } from '@/lib/files/timeline'
import { requireAccount } from '@/lib/http/access'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

const api = routes('/api/files/timeline', {
  envelope: 'api',
  failure: { message: 'Failed to fetch file timeline' },
  logger: loggers.files,
})

export const GET = api(async (request) => {
  const user = await requireAccount(request)
  return apiResponse(
    await fileTimeline(user.id, new URL(request.url).searchParams)
  )
})
