import { z } from 'zod'

import { e2eeRoutes, resetLinkField } from '@/lib/auth/e2ee/http'
import {
  ROTATION_BODY_LIMIT,
  rotatedLibraryFields,
} from '@/lib/auth/e2ee/library-records'
import {
  accountRecordSchema,
  sealedKeyringField,
} from '@/lib/auth/e2ee/records'
import { readResetLink, replaceKeysByEmail } from '@/lib/auth/e2ee/service'
import { readSignedRequest } from '@/lib/auth/e2ee/signed-request'
import { getEmailConfig } from '@/lib/email/config'
import { limitEmailRequest } from '@/lib/email/rate-limit'
import { refuseApiCredentials } from '@/lib/http/access'
import { assertBrowserWrite } from '@/lib/http/request'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/e2ee/recovery', e2eeRoutes)

const recoverySchema = z.strictObject({
  token: resetLinkField,
  account: accountRecordSchema,
  sealedKeyring: sealedKeyringField,
  ...rotatedLibraryFields,
})

/**
 * Recovery with the mnemonic (docs/e2ee-spec.md, section 6.8): a rotation
 * whose proofs are the email reset link and a request signed with the
 * account key that the mnemonic gives. The link replaces the passphrase
 * proof of a rotation. It is used up only when the recovery succeeds.
 */
export const POST = api(
  async (request) => {
    refuseApiCredentials(request)
    assertBrowserWrite(request)
    const config = await getEmailConfig()
    await limitEmailRequest(request, config)
    const signed = await readSignedRequest(request, {
      limit: ROTATION_BODY_LIMIT,
    })
    const body = signed.body(recoverySchema)
    const account = await readResetLink(body.token, config)
    await signed.verify('e2ee_recovery', account)
    await replaceKeysByEmail(body.token, config, body.account, {
      proven: account,
      sealedKeyring: body.sealedKeyring,
      library: { folders: body.folders, tags: body.tags },
    })
    return {
      message: 'Your passphrase was changed. Sign in with your new passphrase.',
    }
  },
  { audit: { action: 'auth.keys.recover', category: 'authentication' } }
)
