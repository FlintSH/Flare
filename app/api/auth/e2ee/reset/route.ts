import { z } from 'zod'

import {
  E2EE_BODY_LIMIT,
  e2eeRoutes,
  resetLinkField,
} from '@/lib/auth/e2ee/http'
import { accountRecordSchema } from '@/lib/auth/e2ee/records'
import { replaceKeysByEmail } from '@/lib/auth/e2ee/service'
import { getEmailConfig } from '@/lib/email/config'
import { limitEmailRequest } from '@/lib/email/rate-limit'
import { refuseApiCredentials } from '@/lib/http/access'
import { assertBrowserWrite, readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/e2ee/reset', e2eeRoutes)

/**
 * Reset without the mnemonic (docs/e2ee-spec.md, section 6.9). The email
 * reset link is the only proof. The account gets a new account record from a
 * new `root_entropy`: the old keyring is deleted, every session and token is
 * cancelled, and no key of the account opens its old encrypted files. Plain
 * files are not changed.
 *
 * An account that still signs in with a password gets its keys this way too,
 * and its password hash is deleted.
 */
export const POST = api(
  async (request) => {
    refuseApiCredentials(request)
    assertBrowserWrite(request)
    const { token, account } = await readJson(
      request,
      z.strictObject({ token: resetLinkField, account: accountRecordSchema }),
      { limit: E2EE_BODY_LIMIT }
    )
    const config = await getEmailConfig()
    await limitEmailRequest(request, config)
    await replaceKeysByEmail(token, config, account)
    return {
      message: 'Your passphrase was set. Sign in with your new passphrase.',
    }
  },
  { audit: { action: 'auth.keys.reset', category: 'authentication' } }
)
