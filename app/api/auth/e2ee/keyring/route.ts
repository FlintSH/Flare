import { z } from 'zod'

import { E2EE_BODY_LIMIT, e2eeRoutes, keyedSession } from '@/lib/auth/e2ee/http'
import { sealedKeyringField } from '@/lib/auth/e2ee/records'
import { replaceKeyring } from '@/lib/auth/e2ee/service'
import { readSignedRequest } from '@/lib/auth/e2ee/signed-request'
import { securityLimit } from '@/lib/auth/security/shared'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/e2ee/keyring', e2eeRoutes)

/**
 * Replaces `sealed_keyring` after the stanza migration removed an old key
 * (docs/e2ee-spec.md, section 8.3.4, step 5). `null` stores no keyring, for
 * an account whose last old key is gone. The request is signed with the
 * current account key.
 */
export const PUT = api(
  async (request) => {
    const { user } = await keyedSession(request)
    await securityLimit(`management:${user.id}`)
    const signed = await readSignedRequest(request, { limit: E2EE_BODY_LIMIT })
    const { sealedKeyring } = signed.body(
      z.strictObject({ sealedKeyring: sealedKeyringField })
    )
    await signed.verify('e2ee_session', user)
    await replaceKeyring(user.id, user, sealedKeyring)
    return { ok: true }
  },
  { audit: { action: 'auth.keys.keyring', category: 'authentication' } }
)
