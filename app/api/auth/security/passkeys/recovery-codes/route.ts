import { z } from 'zod'

import {
  SECURITY_BODY_LIMIT,
  securityRoutes,
  securitySession,
} from '@/lib/auth/security/http'
import { rotatePasskeyRecoveryCodes } from '@/lib/auth/security/required-passkeys'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/security/passkeys/recovery-codes', securityRoutes)

export const POST = api(async (request) => {
  const { session } = await securitySession(request)
  z.object({})
    .strict()
    .parse(await readJson(request, { limit: SECURITY_BODY_LIMIT }))
  return rotatePasskeyRecoveryCodes(session)
})
