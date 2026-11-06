import { folderRoutes } from '@/lib/folders/http'
import { folderInputSchema } from '@/lib/folders/schema'
import { createFolder, listFolders } from '@/lib/folders/service'
import { requireAccount } from '@/lib/http/access'
import { assertJsonMutation, readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'

const api = routes('/api/folders', folderRoutes)

export const GET = api(async (request) => {
  const user = await requireAccount(request)
  const result = apiResponse(await listFolders(user.id))
  result.headers.set('Cache-Control', 'private, no-store')
  return result
})

export const POST = api(async (request) => {
  const user = await requireAccount(request)
  assertJsonMutation(request)
  const input = folderInputSchema.parse(await readJson(request))
  return apiResponse(await createFolder(user.id, input))
})
