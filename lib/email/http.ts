import { requireSession } from '@/lib/http/access'
import type { RouteContract } from '@/lib/http/route'

import { getEmailConfig } from './config'

/** Account email routes. Provider errors, credentials, database details and token values never reach the response. */
export const emailRoutes: RouteContract = {
  failure: {
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
