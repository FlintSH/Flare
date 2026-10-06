import { z } from 'zod'

import { withAuditRoute } from '@/lib/audit'
import {
  securityBody,
  securityRoute,
  securitySession,
} from '@/lib/auth/security/http'
import { setPasskeyRequired } from '@/lib/auth/security/required-passkeys'

async function handlePOST(req: Request) {
  return securityRoute(async () => {
    const { session } = await securitySession(req)
    const { required } = z
      .object({ required: z.boolean() })
      .parse(await securityBody(req))
    return setPasskeyRequired(session, required)
  })
}

export async function POST(req: Request) {
  return withAuditRoute(async () => handlePOST(req), {
    route: '/api/auth/security/passkeys/require',
  })(req)
}
