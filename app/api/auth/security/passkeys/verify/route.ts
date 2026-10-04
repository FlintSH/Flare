import type { RegistrationResponseJSON } from '@simplewebauthn/server'

import {
  challengeResponseSchema,
  securityBody,
  securityRoute,
  securitySession,
} from '@/lib/auth/security/http'
import { registerPasskey } from '@/lib/auth/security/passkeys'

export async function POST(req: Request) {
  return securityRoute(async () => {
    const { session } = await securitySession(req)
    const data = challengeResponseSchema.parse(await securityBody(req))
    return registerPasskey(
      session,
      data.challengeId,
      data.response as unknown as RegistrationResponseJSON
    )
  })
}
