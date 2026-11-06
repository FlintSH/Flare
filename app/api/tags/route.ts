import { requireAccount } from '@/lib/http/access'
import { readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { tagRoutes } from '@/lib/tags/http'
import { createTag, listTags } from '@/lib/tags/manage'
import { tagInputSchema } from '@/lib/tags/schema'

const api = routes('/api/tags', tagRoutes)

export const GET = api(async (request) => {
  const user = await requireAccount(request)
  return apiResponse(await listTags(user.id))
})

export const POST = api(async (request) => {
  const user = await requireAccount(request)
  const input = await readJson(request, tagInputSchema)
  return apiResponse(await createTag(user.id, input))
})
