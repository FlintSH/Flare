import { z } from 'zod'

import { withAuditRoute } from '@/lib/audit'
import {
  securityBody,
  securityRoute,
  securitySession,
} from '@/lib/auth/security/http'
import { rotatePasskeyRecoveryCodes } from '@/lib/auth/security/required-passkeys'

async function handlePOST(req: Request) {
  return securityRoute(async () => {
    const { session } = await securitySession(req)
    z.object({})
      .strict()
      .parse(await securityBody(req))
    return rotatePasskeyRecoveryCodes(session)
  })
}

export async function POST(req: Request) {
  return withAuditRoute(async () => handlePOST(req), {
    route: '/api/auth/security/passkeys/recovery-codes',
  })(req)
}
