import { z } from 'zod'

import {
  IDENTIFIER_MAX_LENGTH,
  fakePassphraseSalt,
  findAccountByIdentifier,
} from '@/lib/auth/e2ee/accounts'
import { issueE2eeChallenge } from '@/lib/auth/e2ee/challenges'
import { E2EE_BODY_LIMIT, e2eeRoutes } from '@/lib/auth/e2ee/http'
import { encodeBytes, hasAccountKeys } from '@/lib/auth/e2ee/records'
import { securityLimit } from '@/lib/auth/security/shared'
import { prisma } from '@/lib/database/prisma'
import { PROTOCOL_VERSION } from '@/lib/e2ee'
import { refuseApiCredentials } from '@/lib/http/access'
import { assertBrowserWrite, readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { clientIp } from '@/lib/security/client-ip'

const api = routes('/api/auth/e2ee/challenge', e2eeRoutes)

/** A sign-in takes a challenge for each attempt, and a second one for its authenticator code. */
const CHALLENGES_PER_WINDOW = 300

/**
 * Salt and challenge for a passphrase sign-in (docs/e2ee-spec.md, section
 * 6.1). An unknown identifier gets an answer of the same form, with a salt
 * that is always the same for that identifier, after the same queries: one
 * lookup and one stored challenge. Nothing can sign in with that challenge.
 *
 * The one different answer is for an account that still signs in with a
 * password (section 14.1): the sign-in page must show the password form.
 */
export const POST = api(async (request) => {
  refuseApiCredentials(request)
  assertBrowserWrite(request)
  await securityLimit(
    `e2ee-challenge:${clientIp(request.headers) ?? 'unknown'}`,
    CHALLENGES_PER_WINDOW
  )
  const { identifier } = await readJson(
    request,
    z.strictObject({
      identifier: z.string().min(1).max(IDENTIFIER_MAX_LENGTH),
    }),
    { limit: E2EE_BODY_LIMIT }
  )
  const account = await findAccountByIdentifier(prisma, identifier)
  // Calculated for a known account too, so that both answers do the same work.
  const fakeSalt = fakePassphraseSalt(identifier)
  if (account && account.password && !hasAccountKeys(account))
    return { method: 'password' }
  // An account with no keys and no password signs in with a passkey or SSO.
  // It answers as an unknown identifier does.
  const keyed = account && hasAccountKeys(account) ? account : null
  const challenge = await issueE2eeChallenge('e2ee_sign_in', {
    userId: keyed?.id ?? null,
  })
  return {
    method: 'passphrase',
    passphraseSalt: encodeBytes(keyed?.passphraseSalt ?? fakeSalt),
    protocolVersion: keyed?.e2eeProtocolVersion ?? PROTOCOL_VERSION,
    challenge,
  }
})
