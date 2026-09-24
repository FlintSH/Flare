import { apiResponse } from '@/lib/api/response'
import { requireAuth } from '@/lib/auth/api-auth'
import { folderErrorResponse, folderMutationGuard } from '@/lib/folders/http'
import { folderUpdateSchema } from '@/lib/folders/schema'
import { deleteFolder, updateFolder } from '@/lib/folders/service'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { user, response } = await requireAuth(request)
    if (response) return response
    const guarded = folderMutationGuard(request)
    if (guarded) return guarded
    const { id } = await params
    const input = folderUpdateSchema.parse(await request.json())
    return apiResponse(await updateFolder(user.id, id, input))
  } catch (error) {
    return folderErrorResponse(error)
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const { user, response } = await requireAuth(request)
    if (response) return response
    const guarded = folderMutationGuard(request, false)
    if (guarded) return guarded
    const { id } = await params
    await deleteFolder(user.id, id)
    return apiResponse({ deleted: true })
  } catch (error) {
    return folderErrorResponse(error)
  }
}
