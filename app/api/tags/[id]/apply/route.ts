import { requireAccount } from '@/lib/http/access'
import { mediaType, readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { tagRoutes } from '@/lib/tags/http'
import { applyTagInputSchema } from '@/lib/tags/schema'
import { applyTagToExistingFiles, applyTagToFiles } from '@/lib/tags/service'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/tags/[id]/apply', tagRoutes)

/**
 * Applies the rule of a tag to the files that exist already. Without a
 * body, the server matches the rule of a plain tag. With `fileIds`, the
 * owner's browser matched the rule, which the server cannot read for a
 * sealed tag (docs/e2ee-spec.md, section 9.8.3), and names the files.
 */
export const POST = api(async (request, { params }: Context) => {
  const user = await requireAccount(request)
  const { id } = await params
  const input =
    mediaType(request) === 'application/json'
      ? await readJson(request, applyTagInputSchema)
      : undefined
  const count = input
    ? await applyTagToFiles(user.id, id, input.fileIds)
    : await applyTagToExistingFiles(user.id, id)
  return apiResponse({ count })
})
