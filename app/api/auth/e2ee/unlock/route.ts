import { z } from 'zod'

import { verifyAuthKeyProof } from '@/lib/auth/e2ee/accounts'
import {
  E2EE_BODY_LIMIT,
  e2eeRoutes,
  keyedSession,
  limitKeyAttempt,
} from '@/lib/auth/e2ee/http'
import {
  challengeField,
  encodeBytes,
  signatureField,
} from '@/lib/auth/e2ee/records'
import { SecurityError } from '@/lib/auth/security/shared'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/e2ee/unlock', e2eeRoutes)

/**
 * Releases the key material (docs/e2ee-spec.md, section 6.3, steps 5 and 6).
 * A session alone never gets `wrapped_root`: the request must carry the
 * unlock signature of the sign-in key on a new challenge, so a person who
 * steals a session cannot start offline guesses. The session itself already
 * passed the second factor of the account.
 */
export const POST = api(
  async (request) => {
    const { user } = await keyedSession(request)
    await limitKeyAttempt(request, 'e2ee-unlock', user.id)
    const proof = await readJson(
      request,
      z.strictObject({ challenge: challengeField, signature: signatureField }),
      { limit: E2EE_BODY_LIMIT }
    )
    if (!(await verifyAuthKeyProof('unlock', proof, 'e2ee_session', user)))
      throw new SecurityError(
        'The passphrase proof is not valid, or its challenge expired or was already used.',
        400,
        { body: { code: 'invalid_proof' } }
      )
    return {
      accountPublicKey: encodeBytes(user.accountPublicKey),
      protocolVersion: user.e2eeProtocolVersion,
      wrappedRoot: encodeBytes(user.wrappedRoot),
      sealedKeyring: user.sealedKeyring && encodeBytes(user.sealedKeyring),
    }
  },
  { audit: { action: 'auth.keys.unlock', category: 'authentication' } }
)
