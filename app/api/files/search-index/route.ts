import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { requireAccount } from '@/lib/http/access'
import { readJson } from '@/lib/http/request'
import { apiResponse } from '@/lib/http/response'
import { routes } from '@/lib/http/route'
import { BATCH_LIMIT } from '@/lib/library/contract'
import { loggers } from '@/lib/logger'
import { requeueSearchIndex, searchIndexSummary } from '@/lib/search/store'
import { nudgeSearchIndex } from '@/lib/search/worker'
import { rateLimit, requestLimit } from '@/lib/security/rate-limit'

const api = routes('/api/files/search-index', {
  envelope: 'api',
  failure: { message: 'Failed to read the search index' },
  logger: loggers.files,
})

/** Asking to read files again costs server time; ten requests per ten minutes. */
const retryLimiter = requestLimit('search-index-retry', 10, 10 * 60)

/** How much of the caller's library search has read, and what it may read. */
export const GET = api(async (request) => {
  const user = await requireAccount(request)
  const [summary, config] = await Promise.all([
    searchIndexSummary(user.id),
    getConfig(),
  ])
  const { ocr, search } = config.settings.general
  return apiResponse({
    ...summary,
    reads: { imageText: ocr.enabled, documents: search.documents },
  })
})

const retrySchema = z.union([
  z.strictObject({ failed: z.literal(true) }),
  z.strictObject({
    fileIds: z.array(z.string().min(1).max(128)).min(1).max(BATCH_LIMIT),
  }),
])

/**
 * Read files again: those that failed, or chosen files of the caller's.
 * Files already waiting are left alone; others keep their text until the new
 * result replaces it.
 */
export const POST = api(async (request) => {
  const limited = await rateLimit(request, retryLimiter)
  if (limited) return limited
  const user = await requireAccount(request)
  const input = await readJson(request, retrySchema)
  const queued = await requeueSearchIndex(
    user.id,
    'failed' in input
      ? { failed: true }
      : { fileIds: [...new Set(input.fileIds)] }
  )
  if (queued) nudgeSearchIndex()
  return apiResponse({ queued })
})
