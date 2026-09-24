import { apiError } from '@/lib/api/response'
import {
  readSavedViewBody,
  savedViewErrorResponse,
  savedViewMutationGuard,
  savedViewResponse,
  savedViewUser,
} from '@/lib/saved-views/http'
import {
  savedViewDeleteSchema,
  savedViewUpdateSchema,
} from '@/lib/saved-views/schema'
import { deleteSavedView, updateSavedView } from '@/lib/saved-views/service'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: Context) {
  try {
    const user = await savedViewUser(request)
    if (!user) return apiError('Sign in to use saved views.', 401)
    const guarded = savedViewMutationGuard(request)
    if (guarded) return guarded
    const { id } = await params
    const input = savedViewUpdateSchema.parse(await readSavedViewBody(request))
    return savedViewResponse(await updateSavedView(user.id, id, input))
  } catch (error) {
    return savedViewErrorResponse(error)
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const user = await savedViewUser(request)
    if (!user) return apiError('Sign in to use saved views.', 401)
    const guarded = savedViewMutationGuard(request)
    if (guarded) return guarded
    const { id } = await params
    const input = savedViewDeleteSchema.parse(await readSavedViewBody(request))
    await deleteSavedView(user.id, id, input.revision)
    return savedViewResponse({ deleted: true })
  } catch (error) {
    return savedViewErrorResponse(error)
  }
}
