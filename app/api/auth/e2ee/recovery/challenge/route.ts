import { z } from 'zod'

import { issueE2eeChallenge } from '@/lib/auth/e2ee/challenges'
import {
  E2EE_BODY_LIMIT,
  e2eeRoutes,
  resetLinkField,
} from '@/lib/auth/e2ee/http'
import { sealedLibraryRecords } from '@/lib/auth/e2ee/library-records'
import { encodeBytes, hasAccountKeys } from '@/lib/auth/e2ee/records'
import { readResetLink } from '@/lib/auth/e2ee/service'
import { securityLimit } from '@/lib/auth/security/shared'
import { prisma } from '@/lib/database/prisma'
import { getEmailConfig } from '@/lib/email/config'
import { refuseApiCredentials } from '@/lib/http/access'
import { assertBrowserWrite, readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import { clientIp } from '@/lib/security/client-ip'

const api = routes('/api/auth/e2ee/recovery/challenge', e2eeRoutes)

/**
 * What an email reset link can do, without using the link up, and the
 * challenge for the signed request of a recovery (docs/e2ee-spec.md, section
 * 6.8).
 *
 * The answer has `account_public_key`, so the client can check the mnemonic
 * before it sends anything (step 3), and `sealed_keyring`, which only the
 * account key of the mnemonic opens. It never has `wrapped_root`: a person
 * who has the link and no mnemonic must not get anything to guess the
 * passphrase against.
 *
 * It also has the sealed folder keys and tag records of the account. A
 * recovery is a rotation, so its client seals each of them again for the
 * new account key (section 8.3.3), and it has no session to list them with.
 * Only the account key of the mnemonic opens them.
 */
export const POST = api(async (request) => {
  refuseApiCredentials(request)
  assertBrowserWrite(request)
  await securityLimit(
    `e2ee-recovery-challenge:${clientIp(request.headers) ?? 'unknown'}`,
    30
  )
  const { token } = await readJson(
    request,
    z.strictObject({ token: resetLinkField }),
    { limit: E2EE_BODY_LIMIT }
  )
  const account = await readResetLink(token, await getEmailConfig())
  if (!hasAccountKeys(account)) return { hasKeys: false }
  return {
    hasKeys: true,
    accountPublicKey: encodeBytes(account.accountPublicKey),
    protocolVersion: account.e2eeProtocolVersion,
    sealedKeyring: account.sealedKeyring && encodeBytes(account.sealedKeyring),
    ...(await sealedLibraryRecords(prisma, account.id)),
    challenge: await issueE2eeChallenge('e2ee_recovery', {
      userId: account.id,
      sessionVersion: account.sessionVersion,
    }),
  }
})
