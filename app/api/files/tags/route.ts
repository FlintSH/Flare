import { requireAccount } from '@/lib/http/access'
import { parseInput, readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { BATCH_LIMIT } from '@/lib/library/contract'
import { tagRoutes } from '@/lib/tags/http'
import { fileTagMembership } from '@/lib/tags/membership'
import { fileTagsInputSchema } from '@/lib/tags/schema'
import { TagError, changeFileTags } from '@/lib/tags/service'

const api = routes('/api/files/tags', tagRoutes)

export const GET = api(async (request) => {
  const user = await requireAccount(request)
  const params = new URL(request.url).searchParams
  if (params.getAll('fileIds').length !== 1)
    throw new TagError(`Choose between 1 and ${BATCH_LIMIT} files.`)
  const fileIds = parseInput(
    fileTagsInputSchema.shape.fileIds,
    params
      .get('fileIds')!
      .split(',')
      .map((id) => id.trim())
  )
  return apiResponse({ files: await fileTagMembership(user.id, fileIds) })
})

export const PATCH = api(async (request) => {
  const user = await requireAccount(request)
  const input = await readJson(request, fileTagsInputSchema)
  const count = await changeFileTags(user.id, input)
  return apiResponse({ count })
})
