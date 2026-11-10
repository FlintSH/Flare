import { z } from 'zod'

import { listPendingWork } from '@/lib/files/library-records'
import { requireSession } from '@/lib/http/access'
import { parseInput } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { loggers } from '@/lib/logger'

const api = routes('/api/files/pending', {
  envelope: 'api',
  headers: { 'Cache-Control': 'private, no-store' },
  failure: { message: 'Failed to list the files that wait for work' },
  logger: loggers.files,
})

/**
 * The owner's files that wait for work from a browser: tag rules, the text
 * of an image, a thumbnail (docs/e2ee-spec.md, section 9.7). A script client
 * leaves such work, because it has no key that opens the rules.
 */
export const GET = api(async (request) => {
  const { user } = await requireSession(request, 'files.read', {
    refuseApiCredentials: true,
  })
  const { after } = parseInput(
    z.strictObject({ after: z.string().min(1).max(128).optional() }),
    Object.fromEntries(new URL(request.url).searchParams)
  )
  return apiResponse(await listPendingWork(user.id, after ?? null))
})
