import { fileListPage } from '@/lib/files/list'
import { requireAccount } from '@/lib/http/access'
import { preflight } from '@/lib/http/cors'
import { apiResponse, paginatedResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { rateLimit, uploadLimiter } from '@/lib/security/rate-limit'
import { directUpload } from '@/lib/uploads/direct'
import { uploadRoutes } from '@/lib/uploads/http'

const api = routes('/api/files', uploadRoutes)

export const POST = api(async (request) => {
  const limited = await rateLimit(request, uploadLimiter)
  if (limited) return limited
  const user = await requireAccount(request)
  return apiResponse(await directUpload(request, user))
})

export const GET = api(
  async (request) => {
    const user = await requireAccount(request)
    const { files, pagination } = await fileListPage(
      user.id,
      new URL(request.url).searchParams
    )
    return paginatedResponse(files, pagination)
  },
  {
    envelope: 'api',
    failure: { message: 'Failed to fetch files' },
  }
)

export const OPTIONS = preflight('token')
