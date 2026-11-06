import type { RegistrationResponseJSON } from '@simplewebauthn/server'

import {
  challengeResponseSchema,
  securityBody,
  securityRoutes,
  securitySession,
} from '@/lib/auth/security/http'
import { registerPasskey } from '@/lib/auth/security/passkeys'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/security/passkeys/verify', securityRoutes)

export const POST = api(async (request) => {
  const { session } = await securitySession(request)
  const data = challengeResponseSchema.parse(await securityBody(request))
  return registerPasskey(
    session,
    data.challengeId,
    data.response as unknown as RegistrationResponseJSON
  )
})
