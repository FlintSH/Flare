import { z } from 'zod'

import { accountIdentifier } from '@/lib/auth/e2ee/accounts'
import { E2EE_BODY_LIMIT, e2eeRoutes, e2eeSession } from '@/lib/auth/e2ee/http'
import {
  accountRecordSchema,
  encodeBytes,
  hasAccountKeys,
} from '@/lib/auth/e2ee/records'
import { setUpAccountKeys } from '@/lib/auth/e2ee/service'
import { securityLimit } from '@/lib/auth/security/shared'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/e2ee/keys', e2eeRoutes)

/**
 * Whether the session's account has keys, and the public part of its account
 * record. Never `wrapped_root` or `sealed_keyring`: the unlock route releases
 * those.
 */
export const GET = api(async (request) => {
  const { user } = await e2eeSession(request)
  const keyed = hasAccountKeys(user)
  return {
    hasKeys: keyed,
    identifier: accountIdentifier(user),
    protocolVersion: user.e2eeProtocolVersion,
    accountPublicKey: keyed ? encodeBytes(user.accountPublicKey) : null,
    hasKeyring: Boolean(user.sealedKeyring),
  }
})

/**
 * Key setup for a signed-in account that has no keys (docs/e2ee-spec.md,
 * sections 5.4 and 14.1). Registration and first-run setup create their
 * account with its record and do not call this.
 */
export const POST = api(
  async (request) => {
    const { session, user } = await e2eeSession(request)
    await securityLimit(`management:${user.id}`)
    const { account } = await readJson(
      request,
      z.strictObject({ account: accountRecordSchema }),
      { limit: E2EE_BODY_LIMIT }
    )
    await setUpAccountKeys(session, account)
    return { ok: true }
  },
  { audit: { action: 'auth.keys.setup', category: 'authentication' } }
)
