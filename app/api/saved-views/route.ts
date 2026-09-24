import { apiError } from '@/lib/api/response'
import {
  readSavedViewBody,
  savedViewErrorResponse,
  savedViewMutationGuard,
  savedViewResponse,
  savedViewUser,
} from '@/lib/saved-views/http'
import { savedViewInputSchema } from '@/lib/saved-views/schema'
import { createSavedView, listSavedViews } from '@/lib/saved-views/service'

export async function GET(request: Request) {
  try {
    const user = await savedViewUser(request)
    if (!user) return apiError('Sign in to use saved views.', 401)
    return savedViewResponse(await listSavedViews(user.id))
  } catch (error) {
    return savedViewErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const user = await savedViewUser(request)
    if (!user) return apiError('Sign in to use saved views.', 401)
    const guarded = savedViewMutationGuard(request)
    if (guarded) return guarded
    const input = savedViewInputSchema.parse(await readSavedViewBody(request))
    return savedViewResponse(await createSavedView(user.id, input))
  } catch (error) {
    return savedViewErrorResponse(error)
  }
}
