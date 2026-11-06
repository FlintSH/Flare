import { requireAccount } from '@/lib/http/access'
import { assertJsonMutation, readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { tagRoutes } from '@/lib/tags/http'
import { deleteTag, updateTag } from '@/lib/tags/manage'
import { tagInputSchema } from '@/lib/tags/schema'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/tags/[id]', tagRoutes)

export const PATCH = api(async (request, { params }: Context) => {
  const user = await requireAccount(request)
  assertJsonMutation(request)
  const { id } = await params
  const input = tagInputSchema.parse(await readJson(request))
  return apiResponse(await updateTag(user.id, id, input))
})

export const DELETE = api(async (request, { params }: Context) => {
  const user = await requireAccount(request)
  assertJsonMutation(request, { body: false })
  const { id } = await params
  await deleteTag(user.id, id)
  return apiResponse({ deleted: true })
})
