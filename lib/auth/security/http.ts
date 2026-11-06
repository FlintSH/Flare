import { z } from 'zod'

import { requireSession } from '@/lib/http/access'
import { HttpError } from '@/lib/http/errors'
import { isWrite } from '@/lib/http/request'
import type { RouteContract } from '@/lib/http/route'

import { SECURITY_CODE_MAX_LENGTH } from './policy'
import { securityLimit } from './shared'

export const proofSchema = z.object({
  password: z.string().max(256).optional(),
  code: z.string().max(SECURITY_CODE_MAX_LENGTH).optional(),
})
export const passkeyName = z.string().trim().min(1).max(64)
export const challengeResponseSchema = z.object({
  challengeId: z.string().min(20).max(100),
  response: z
    .object({
      id: z.string().min(1).max(2048),
      rawId: z.string(),
      type: z.literal('public-key'),
      response: z.record(z.string(), z.unknown()),
      clientExtensionResults: z.record(z.string(), z.unknown()),
    })
    .passthrough(),
})

/** Account security routes never cache, and explain only their own refusals. */
export const securityRoutes: RouteContract = {
  headers: { 'Cache-Control': 'no-store' },
  invalid: () => new HttpError(400, 'Invalid security request.'),
  failure: {
    status: 400,
    message: 'Unable to complete this security request. Please try again.',
  },
}

/**
 * The browser session's account as it is now, before email verification too,
 * so a restricted account can still secure itself. Every write counts toward
 * the account's management limit.
 */
export async function securitySession(request: Request) {
  const { session, account } = await requireSession(request, undefined, {
    pendingEmail: true,
    refuseApiCredentials: true,
    fresh: true,
  })
  if (isWrite(request)) await securityLimit(`management:${account.id}`)
  return { session, user: account }
}

/** Security writes are small JSON documents. */
export const SECURITY_BODY_LIMIT = 64 * 1024
