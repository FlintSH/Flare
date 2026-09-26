import { apiResponse } from '@/lib/api/response'
import { requireAuth } from '@/lib/auth/api-auth'
import { folderErrorResponse, folderMutationGuard } from '@/lib/folders/http'
import { folderUpdateSchema } from '@/lib/folders/schema'
import { deleteFolder, updateFolder } from '@/lib/folders/service'
import { hasPermission } from '@/lib/permissions/catalog'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { user, response } = await requireAuth(request)
    if (response) return response
    const guarded = folderMutationGuard(request)
    if (guarded) return guarded
    const { id } = await params
    const input = folderUpdateSchema.parse(await request.json())
    if (input.sharing !== undefined && !hasPermission(user, 'folders.share'))
      return Response.json(
        { error: 'You do not have permission to share folders.' },
        { status: 403 }
      )
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
