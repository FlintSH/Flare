import { z } from 'zod'

import {
  securityBody,
  securityRoute,
  securitySession,
} from '@/lib/auth/security/http'
import { setPasskeyRequired } from '@/lib/auth/security/required-passkeys'

export async function POST(req: Request) {
  return securityRoute(async () => {
    const { session } = await securitySession(req)
    const { required } = z
      .object({ required: z.boolean() })
      .parse(await securityBody(req))
    return setPasskeyRequired(session, required)
  })
}
