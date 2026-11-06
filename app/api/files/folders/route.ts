import { folderRoutes } from '@/lib/folders/http'
import { fileFoldersInputSchema } from '@/lib/folders/schema'
import { moveFilesToFolder } from '@/lib/folders/service'
import { requireAccount } from '@/lib/http/access'
import { assertJsonMutation, readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'

const api = routes('/api/files/folders', folderRoutes)

export const POST = api(async (request) => {
  const user = await requireAccount(request)
  assertJsonMutation(request)
  const input = fileFoldersInputSchema.parse(await readJson(request))
  return apiResponse({ count: await moveFilesToFolder(user.id, input) })
})
