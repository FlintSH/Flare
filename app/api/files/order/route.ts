import { z } from 'zod'

import { plainFileOrder } from '@/lib/files/order'
import { requireSession } from '@/lib/http/access'
import { parseInput } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

const api = routes('/api/files/order', {
  envelope: 'api',
  headers: { 'Cache-Control': 'private, no-store' },
  failure: { message: 'Failed to list files' },
  logger: loggers.files,
})

/**
 * The IDs and sort keys of the plain files that a library view selects, for
 * the owner's browser to merge with the encrypted files it matched itself
 * (docs/e2ee-spec.md, section 9.8). It takes the filters of `GET /api/files`
 * and `after` to page.
 */
export const GET = api(async (request) => {
  const { user } = await requireSession(request, 'files.read', {
    refuseApiCredentials: true,
  })
  const params = new URL(request.url).searchParams
  const after = params.get('after')
  params.delete('after')
  return apiResponse(
    await plainFileOrder(
      user.id,
      params,
      after === null ? null : parseInput(z.string().min(1).max(128), after)
    )
  )
})
