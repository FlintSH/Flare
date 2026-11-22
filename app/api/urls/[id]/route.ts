import { requireAccount } from '@/lib/http/access'
import { preflight } from '@/lib/http/cors'
import { readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { shortLinkUpdateSchema } from '@/lib/links/schema'
import { deleteOwnShortLink, updateOwnShortLink } from '@/lib/links/service'
import { loggers } from '@/lib/logger'

type Context = { params: Promise<{ id: string }> }

const api = routes('/api/urls/[id]', {
  envelope: 'api',
  failure: { message: 'Internal server error' },
  logger: loggers.api,
})

/** A new destination; the code and its clicks stay. */
export const PATCH = api(async (request, { params }: Context) => {
  const user = await requireAccount(request)
  const { id } = await params
  const { url } = await readJson(request, shortLinkUpdateSchema)
  return apiResponse(await updateOwnShortLink(user.id, id, url))
})

export const DELETE = api(async (request, { params }: Context) => {
  const user = await requireAccount(request)
  const { id } = await params
  await deleteOwnShortLink(user.id, id)
  return new Response(null, { status: 204 })
})

export const OPTIONS = preflight('token')
