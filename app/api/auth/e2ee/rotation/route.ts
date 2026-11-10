import { z } from 'zod'

import { verifyAuthKeyProof } from '@/lib/auth/e2ee/accounts'
import {
  E2EE_BODY_LIMIT,
  e2eeRoutes,
  keyedSession,
  limitKeyAttempt,
} from '@/lib/auth/e2ee/http'
import {
  accountRecordSchema,
  challengeField,
  sealedKeyringField,
  signatureField,
} from '@/lib/auth/e2ee/records'
import { rotateAccountKeys } from '@/lib/auth/e2ee/service'
import { readSignedRequest } from '@/lib/auth/e2ee/signed-request'
import { SecurityError, securityLimit } from '@/lib/auth/security/shared'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/e2ee/rotation', e2eeRoutes)

const rotationSchema = z.strictObject({
  account: accountRecordSchema,
  sealedKeyring: sealedKeyringField,
  passphraseProof: z.strictObject({
    challenge: challengeField,
    signature: signatureField,
  }),
})

/**
 * Key rotation, which is also the only passphrase change (docs/e2ee-spec.md,
 * sections 6.7 and 8.3.3, steps 6 to 8). The session is not enough, and
 * neither proof is enough alone:
 *
 * - the request is signed with the old account key (section 6.6), and
 * - `passphraseProof` is a sign-in signature of the old sign-in key on its
 *   own new challenge.
 *
 * The browser stores the account key. A person who steals it there has no
 * passphrase, cannot make the second proof, and so cannot lock the owner out.
 */
export const POST = api(
  async (request) => {
    const { user } = await keyedSession(request)
    await securityLimit(`management:${user.id}`)
    await limitKeyAttempt(request, 'e2ee-rotation', user.id)
    const signed = await readSignedRequest(request, { limit: E2EE_BODY_LIMIT })
    const body = signed.body(rotationSchema)
    // Check both proofs before either answer, so each challenge is used up.
    const passphraseProven = await verifyAuthKeyProof(
      'sign-in',
      body.passphraseProof,
      'e2ee_session',
      user
    )
    await signed.verify('e2ee_session', user)
    if (!passphraseProven)
      throw new SecurityError(
        'The passphrase proof is not valid, or its challenge expired or was already used.',
        400,
        { body: { code: 'invalid_proof' } }
      )
    await rotateAccountKeys(user.id, user, body.account, body.sealedKeyring)
    // Every session ended, this one too: the client signs in with the new passphrase.
    return { ok: true, signInAgain: true }
  },
  { audit: { action: 'auth.keys.rotate', category: 'authentication' } }
)
