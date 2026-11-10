import { z } from 'zod'

import { plainFileText } from '@/lib/files/sync'
import { requireSession } from '@/lib/http/access'
import { parseInput } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

const api = routes('/api/files/text', {
  envelope: 'api',
  headers: { 'Cache-Control': 'private, no-store' },
  failure: { message: 'Failed to read file names' },
  logger: loggers.files,
})

const querySchema = z.strictObject({
  after: z.string().min(1).max(128).optional(),
})

/**
 * The names and the image text of the owner's plain files, in pages. The
 * rule of a sealed tag never reaches the server, so the owner's browser
 * reads these and applies the rule itself (docs/e2ee-spec.md, section 9.5).
 */
export const GET = api(async (request) => {
  const { user } = await requireSession(request, 'files.read', {
    refuseApiCredentials: true,
  })
  const { after } = parseInput(
    querySchema,
    Object.fromEntries(new URL(request.url).searchParams)
  )
  return apiResponse(await plainFileText(user.id, after ?? null))
})
