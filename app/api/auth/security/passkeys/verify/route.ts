import type { RegistrationResponseJSON } from '@simplewebauthn/server'

import { withAuditRoute } from '@/lib/audit'
import {
  challengeResponseSchema,
  securityBody,
  securityRoute,
  securitySession,
} from '@/lib/auth/security/http'
import { registerPasskey } from '@/lib/auth/security/passkeys'

async function handlePOST(req: Request) {
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

export async function POST(req: Request) {
  return withAuditRoute(async () => handlePOST(req), {
    route: '/api/auth/security/passkeys/verify',
  })(req)
}
