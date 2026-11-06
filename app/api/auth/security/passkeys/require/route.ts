import { z } from 'zod'

import {
  securityBody,
  securityRoutes,
  securitySession,
} from '@/lib/auth/security/http'
import { setPasskeyRequired } from '@/lib/auth/security/required-passkeys'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/security/passkeys/require', securityRoutes)

export const POST = api(async (request) => {
  const { session } = await securitySession(request)
  const { required } = z
    .object({ required: z.boolean() })
    .parse(await securityBody(request))
  return setPasskeyRequired(session, required)
})
