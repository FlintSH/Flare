import { z } from 'zod'

import {
  SECURITY_BODY_LIMIT,
  securityRoutes,
  securitySession,
} from '@/lib/auth/security/http'
import { setPasskeyRequired } from '@/lib/auth/security/required-passkeys'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/security/passkeys/require', securityRoutes)

export const POST = api(async (request) => {
  const { session } = await securitySession(request)
  const { required } = await readJson(
    request,
    z.object({ required: z.boolean() }),
    { limit: SECURITY_BODY_LIMIT }
  )
  return setPasskeyRequired(session, required)
})
