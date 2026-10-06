import { apiResponse } from '@/lib/api/response'
import { requireAuth } from '@/lib/auth/api-auth'
import { tagErrorResponse, tagMutationGuard } from '@/lib/tags/http'
import { fileTagMembership } from '@/lib/tags/membership'
import { fileTagsInputSchema } from '@/lib/tags/schema'
import { TagError, changeFileTags } from '@/lib/tags/service'

export async function GET(request: Request) {
  try {
    const { user, response } = await requireAuth(request)
    if (response) return response
    const params = new URL(request.url).searchParams
    if (params.getAll('fileIds').length !== 1)
      throw new TagError('Choose between 1 and 100 files.')
    const fileIds = fileTagsInputSchema.shape.fileIds.parse(
      params
        .get('fileIds')!
        .split(',')
        .map((id) => id.trim())
    )
    const files = await fileTagMembership(user.id, fileIds)
    const result = apiResponse({ files })
    result.headers.set('Cache-Control', 'private, no-store')
    return result
  } catch (error) {
    return tagErrorResponse(error)
  }
}

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
