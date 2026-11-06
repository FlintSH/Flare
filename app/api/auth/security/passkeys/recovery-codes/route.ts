import { z } from 'zod'

import {
  securityBody,
  securityRoutes,
  securitySession,
} from '@/lib/auth/security/http'
import { rotatePasskeyRecoveryCodes } from '@/lib/auth/security/required-passkeys'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/security/passkeys/recovery-codes', securityRoutes)

export const POST = api(async (request) => {
  const { session } = await securitySession(request)
  z.object({})
    .strict()
    .parse(await securityBody(request))
  return rotatePasskeyRecoveryCodes(session)
})
