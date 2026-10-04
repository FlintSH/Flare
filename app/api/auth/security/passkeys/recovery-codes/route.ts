import { z } from 'zod'

import {
  securityBody,
  securityRoute,
  securitySession,
} from '@/lib/auth/security/http'
import { rotatePasskeyRecoveryCodes } from '@/lib/auth/security/required-passkeys'

export async function POST(req: Request) {
  return securityRoute(async () => {
    const { session } = await securitySession(req)
    z.object({})
      .strict()
      .parse(await securityBody(req))
    return rotatePasskeyRecoveryCodes(session)
  })
}
