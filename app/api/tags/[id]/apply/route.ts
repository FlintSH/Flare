import { requireAccount } from '@/lib/http/access'
import { assertJsonMutation } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { tagRoutes } from '@/lib/tags/http'
import { applyTagToExistingFiles } from '@/lib/tags/service'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/tags/[id]/apply', tagRoutes)

export const POST = api(async (request, { params }: Context) => {
  const user = await requireAccount(request)
  assertJsonMutation(request, { body: false })
  const { id } = await params
  const count = await applyTagToExistingFiles(user.id, id)
  return apiResponse({ count })
})
