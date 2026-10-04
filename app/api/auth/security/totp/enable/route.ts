import { z } from 'zod'

import {
  securityBody,
  securityRoute,
  securitySession,
} from '@/lib/auth/security/http'
import { enableTotp } from '@/lib/auth/security/service'

export async function POST(req: Request) {
  return securityRoute(async () => {
    const { session } = await securitySession(req)
    const { code, challengeId } = z
      .object({
        code: z.string().regex(/^\d{6}$/),
        challengeId: z.string().min(20).max(100),
      })
      .parse(await securityBody(req))
    return enableTotp(session, code, challengeId)
  })
}
