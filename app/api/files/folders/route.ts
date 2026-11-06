import { folderRoutes } from '@/lib/folders/http'
import { fileFoldersInputSchema } from '@/lib/folders/schema'
import { moveFilesToFolder } from '@/lib/folders/service'
import { requireAccount } from '@/lib/http/access'
import { readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'

const api = routes('/api/files/folders', folderRoutes)

export const POST = api(async (request) => {
  const user = await requireAccount(request)
  const input = await readJson(request, fileFoldersInputSchema)
  return apiResponse({ count: await moveFilesToFolder(user.id, input) })
})
