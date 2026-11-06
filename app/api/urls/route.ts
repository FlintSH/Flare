import { requireAccount } from '@/lib/http/access'
import { readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { shortLinkInputSchema } from '@/lib/links/schema'
import { createShortLink, listOwnShortLinks } from '@/lib/links/service'
import { loggers } from '@/lib/logger'

const api = routes('/api/urls', {
  envelope: 'api',
  failure: { message: 'Internal server error' },
  logger: loggers.api,
})

export const POST = api(async (request) => {
  const user = await requireAccount(request)
  const { url } = shortLinkInputSchema.parse(await readJson(request))
  return apiResponse(await createShortLink(user.id, url))
})

export const GET = api(async (request) => {
  const user = await requireAccount(request)
  return apiResponse({ urls: await listOwnShortLinks(user.id) })
})
