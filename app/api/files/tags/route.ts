import { apiResponse } from '@/lib/api/response'
import { requireAuth } from '@/lib/auth/api-auth'
import { tagErrorResponse, tagMutationGuard } from '@/lib/tags/http'
import { fileTagsInputSchema } from '@/lib/tags/schema'
import { changeFileTags } from '@/lib/tags/service'

export async function PATCH(request: Request) {
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
