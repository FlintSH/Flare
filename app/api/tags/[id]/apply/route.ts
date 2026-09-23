import { apiResponse } from '@/lib/api/response'
import { requireAuth } from '@/lib/auth/api-auth'
import { tagErrorResponse, tagMutationGuard } from '@/lib/tags/http'
import { applyTagToExistingFiles } from '@/lib/tags/service'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, response } = await requireAuth(request)
    if (response) return response
    const guarded = tagMutationGuard(request, false)
    if (guarded) return guarded
    const { id } = await params
    const count = await applyTagToExistingFiles(user.id, id)
    return apiResponse({ count })
  } catch (error) {
    return tagErrorResponse(error)
  }
}
