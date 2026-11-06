import { folderRoutes } from '@/lib/folders/http'
import { folderUpdateSchema } from '@/lib/folders/schema'
import { deleteFolder, updateFolder } from '@/lib/folders/service'
import { requireAccount } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { hasPermission } from '@/lib/permissions/catalog'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/folders/[id]', folderRoutes)

export const PATCH = api(async (request, { params }: Context) => {
  const user = await requireAccount(request)
  const { id } = await params
  const input = await readJson(request, folderUpdateSchema)
  if (input.sharing !== undefined && !hasPermission(user, 'folders.share'))
    throw new HttpError(403, 'You do not have permission to share folders.')
  return apiResponse(await updateFolder(user.id, id, input))
})

export const DELETE = api(async (request, { params }: Context) => {
  const user = await requireAccount(request)
  const { id } = await params
  await deleteFolder(user.id, id)
  return apiResponse({ deleted: true })
})
