import { requireAccount } from '@/lib/http/access'
import { assertJsonMutation, readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { tagRoutes } from '@/lib/tags/http'
import { createTag, listTags } from '@/lib/tags/manage'
import { tagInputSchema } from '@/lib/tags/schema'

const api = routes('/api/tags', tagRoutes)

export const GET = api(async (request) => {
  const user = await requireAccount(request)
  const result = apiResponse(await listTags(user.id))
  result.headers.set('Cache-Control', 'private, no-store')
  return result
})

export const POST = api(async (request) => {
  const user = await requireAccount(request)
  assertJsonMutation(request)
  const input = tagInputSchema.parse(await readJson(request))
  return apiResponse(await createTag(user.id, input))
})
