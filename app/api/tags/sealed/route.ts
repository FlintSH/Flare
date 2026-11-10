import { requireSession } from '@/lib/http/access'
import { readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { tagRoutes } from '@/lib/tags/http'
import { sealTags } from '@/lib/tags/manage'
import { sealTagsInputSchema } from '@/lib/tags/schema'

const api = routes('/api/tags/sealed', tagRoutes)

/**
 * Stores sealed names and rules for tags from before encryption
 * (docs/e2ee-spec.md, section 9.5). The owner's browser makes each record
 * with a key from the account private key, so only a browser session can
 * call this. The plain name and rule are deleted in the same change.
 */
export const PUT = api(async (request) => {
  const { user } = await requireSession(request, 'tags.manage', {
    refuseApiCredentials: true,
  })
  const input = await readJson(request, sealTagsInputSchema)
  return apiResponse(await sealTags(user.id, input))
})
