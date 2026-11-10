import { z } from 'zod'

import { SecurityError, securityLimit } from '@/lib/auth/security/shared'
import { requireSession } from '@/lib/http/access'
import type { RouteContract } from '@/lib/http/route'
import { clientIp } from '@/lib/security/client-ip'

import { type KeyedAccount, hasAccountKeys } from './records'

/**
 * The account key routes never cache. Their request bodies are strict: a
 * field that a route does not read is refused with its name, so a client
 * that sends a secret by mistake fails at once instead of in silence.
 */
export const e2eeRoutes: RouteContract = {
  headers: { 'Cache-Control': 'no-store' },
  failure: {
    message: 'Unable to complete this encryption request. Please try again.',
  },
}

/** Key requests are small JSON documents. */
export const E2EE_BODY_LIMIT = 64 * 1024

/** An email reset link in a request body. */
export const resetLinkField = z.string().max(128)

/**
 * The browser session's account as it is now, before email verification too:
 * an account sets up and unlocks its keys before anything else. API tokens
 * never authorize a key route.
 */
export async function e2eeSession(request: Request) {
  const { session, account } = await requireSession(request, undefined, {
    pendingEmail: true,
    refuseApiCredentials: true,
    fresh: true,
  })
  return { session, user: account }
}

/** The session's account, which must have completed key setup. */
export async function keyedSession(request: Request) {
  const { session, user } = await e2eeSession(request)
  if (!hasAccountKeys(user))
    throw new SecurityError('Set up encryption for this account first.', 409, {
      body: { code: 'keys_required' },
    })
  return { session, user: user as typeof user & KeyedAccount }
}

/**
 * Counts one attempt against the account and against the client address
 * (docs/e2ee-spec.md, sections 6.2 and 6.3), with the limits of the password
 * sign-in.
 */
export async function limitKeyAttempt(
  request: Request,
  name: string,
  account: string
) {
  const ip = clientIp(request.headers) ?? 'unknown'
  await securityLimit(`${name}-ip:${ip}`, 100)
  await securityLimit(`${name}-account:${account}`, 30)
}
