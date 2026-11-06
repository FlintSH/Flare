import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import type { RouteContract } from '@/lib/http/route'

import { getEmailConfig } from './config'
import { EmailRateLimitError } from './rate-limit'

/** Account email routes. Provider errors, credentials, database details and token values never reach the response. */
export const emailRoutes: RouteContract = {
  translate: (error) => {
    if (error instanceof EmailRateLimitError)
      return new HttpError(429, error.message, {
        headers: { 'Retry-After': String(error.retryAfter) },
      })
  },
  failure: {
    status: 400,
    message: 'Unable to complete this email request. Please try again.',
  },
}

/**
 * The browser session's account as it is now, before email verification too,
 * so a restricted account can verify or replace its address. Upload tokens
 * never authorize account or recovery changes.
 */
export async function emailSession(request: Request) {
  const { session, account } = await requireSession(request, undefined, {
    pendingEmail: true,
    fresh: true,
  })
  return { session, user: account, config: await getEmailConfig() }
}
