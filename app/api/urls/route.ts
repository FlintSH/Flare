import { requireAccount } from '@/lib/http/access'
import { preflight } from '@/lib/http/cors'
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
  const { url, code } = await readJson(request, shortLinkInputSchema)
  return apiResponse(await createShortLink(user.id, url, code))
})

export const GET = api(async (request) => {
  const user = await requireAccount(request)
  // ?id= asks for one of the account's links (a link's sheet), not all:
  // exactly that id, so an empty or over-long one matches nothing.
  const id = new URL(request.url).searchParams.get('id')
  if (id !== null && (!id || id.length > 64)) return apiResponse({ urls: [] })
  return apiResponse({
    urls: await listOwnShortLinks(user.id, id ?? undefined),
  })
})

export const OPTIONS = preflight('token')
