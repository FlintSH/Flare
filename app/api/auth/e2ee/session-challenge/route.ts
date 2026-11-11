import { accountIdentifier } from '@/lib/auth/e2ee/accounts'
import { issueE2eeChallenge } from '@/lib/auth/e2ee/challenges'
import { e2eeRoutes, keyedSession } from '@/lib/auth/e2ee/http'
import { encodeBytes } from '@/lib/auth/e2ee/records'
import { SecurityError, securityLimit } from '@/lib/auth/security/shared'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/e2ee/session-challenge', e2eeRoutes)

/**
 * A challenge for the account of the session: for unlock (docs/e2ee-spec.md,
 * section 6.3, step 3), for a signed request (section 6.6, step 1) and for
 * the passphrase proof of a rotation (section 8.3.3, step 6). Each proof
 * needs its own challenge.
 *
 * The answer also has what a client needs to make the keys of the passphrase
 * after a sign-in with a passkey or SSO: the salt, and the identifier that
 * the signatures of the sign-in key bind to.
 */
export const POST = api(async (request) => {
  const { user } = await keyedSession(request)
  await securityLimit(`e2ee-session-challenge:${user.id}`, 120)
  const identifier = accountIdentifier(user)
  if (!identifier)
    throw new SecurityError('This account has no sign-in address.', 409)
  return {
    challenge: await issueE2eeChallenge('e2ee_session', {
      userId: user.id,
      sessionVersion: user.sessionVersion,
    }),
    identifier,
    passphraseSalt: encodeBytes(user.passphraseSalt),
    protocolVersion: user.e2eeProtocolVersion,
    accountPublicKey: encodeBytes(user.accountPublicKey),
  }
})
