import { requireAccount } from '@/lib/http/access'
import { assertJsonMutation, readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { tagRoutes } from '@/lib/tags/http'
import { fileTagMembership } from '@/lib/tags/membership'
import { fileTagsInputSchema } from '@/lib/tags/schema'
import { TagError, changeFileTags } from '@/lib/tags/service'

const api = routes('/api/files/tags', tagRoutes)

export const GET = api(async (request) => {
  const user = await requireAccount(request)
  const params = new URL(request.url).searchParams
  if (params.getAll('fileIds').length !== 1)
    throw new TagError('Choose between 1 and 100 files.')
  const fileIds = fileTagsInputSchema.shape.fileIds.parse(
    params
      .get('fileIds')!
      .split(',')
      .map((id) => id.trim())
  )
  const files = await fileTagMembership(user.id, fileIds)
  const result = apiResponse({ files })
  result.headers.set('Cache-Control', 'private, no-store')
  return result
})

export const PATCH = api(async (request) => {
  const user = await requireAccount(request)
  assertJsonMutation(request)
  const input = fileTagsInputSchema.parse(await readJson(request))
  const count = await changeFileTags(user.id, input)
  return apiResponse({ count })
})
