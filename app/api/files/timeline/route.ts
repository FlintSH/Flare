import { HTTP_STATUS, apiError, apiResponse } from '@/lib/api/response'
import { requireAuth } from '@/lib/auth/api-auth'
import { FileListInputError } from '@/lib/files/list-filters'
import { fileTimeline } from '@/lib/files/timeline'
import { loggers } from '@/lib/logger'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const { user, response } = await requireAuth(request)
    if (response) return response
    const timeline = await fileTimeline(
      user.id,
      new URL(request.url).searchParams
    )
    const result = apiResponse(timeline)
    result.headers.set('Cache-Control', 'private, no-store')
    return result
  } catch (error) {
    if (error instanceof FileListInputError)
      return apiError(error.message, HTTP_STATUS.BAD_REQUEST)
    loggers.files.error('Error fetching file timeline', error as Error)
    return apiError(
      'Failed to fetch file timeline',
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    )
  }
}
