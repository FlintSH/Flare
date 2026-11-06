import type { RegistrationResponseJSON } from '@simplewebauthn/server'

import {
  SECURITY_BODY_LIMIT,
  challengeResponseSchema,
  securityRoutes,
  securitySession,
} from '@/lib/auth/security/http'
import { registerPasskey } from '@/lib/auth/security/passkeys'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/security/passkeys/verify', securityRoutes)

export const POST = api(async (request) => {
  const { session } = await securitySession(request)
  const data = await readJson(request, challengeResponseSchema, {
    limit: SECURITY_BODY_LIMIT,
  })
  return registerPasskey(
    session,
    data.challengeId,
    data.response as unknown as RegistrationResponseJSON
  )
})
