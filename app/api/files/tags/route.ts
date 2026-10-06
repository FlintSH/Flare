import { apiResponse } from '@/lib/api/response'
import { withAuditRoute } from '@/lib/audit'
import { requireAuth } from '@/lib/auth/api-auth'
import { tagErrorResponse, tagMutationGuard } from '@/lib/tags/http'
import { fileTagsInputSchema } from '@/lib/tags/schema'
import { changeFileTags } from '@/lib/tags/service'

async function handlePATCH(request: Request) {
  try {
    const { user, response } = await requireAuth(request)
    if (response) return response
    const guarded = tagMutationGuard(request)
    if (guarded) return guarded
    const input = fileTagsInputSchema.parse(await request.json())
    const count = await changeFileTags(user.id, input)
    return apiResponse({ count })
  } catch (error) {
    return tagErrorResponse(error)
  }
}

export async function PATCH(request: Request) {
  return withAuditRoute(async () => handlePATCH(request), {
    route: '/api/files/tags',
  })(request)
}
