import { z } from 'zod'

import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { FIND_MAXIMUM, FIND_MINIMUM } from '@/lib/search/contract'
import { findOwnContent } from '@/lib/search/service'
import { findLimiter, rateLimitAccount } from '@/lib/security/rate-limit'

const api = routes('/api/search', {
  failure: { message: 'Search failed. Try again.' },
  audit: { skipSuccess: true },
})

const findSchema = z.strictObject({
  q: z.string().trim().min(FIND_MINIMUM).max(FIND_MAXIMUM),
})

/**
 * Find: the signed-in account's own files, links and folders matching a few
 * typed words. The words travel in the body, so they stay out of request
 * logs. Browser sessions only; tokens use the list routes.
 */
export const POST = api(
  async (request) => {
    const { user } = await requireSession(request)
    const limited = await rateLimitAccount(user.id, findLimiter)
    if (limited) return limited
    const { q } = await readJson(request, findSchema, { limit: 1024 })
    return { data: await findOwnContent(user, q) }
  },
  {
    invalid: () =>
      new HttpError(
        400,
        `Search for ${FIND_MINIMUM} to ${FIND_MAXIMUM} characters.`
      ),
  }
)
