import { z } from 'zod'

import {
  securityBody,
  securityRoutes,
  securitySession,
} from '@/lib/auth/security/http'
import { isTotpCode } from '@/lib/auth/security/policy'
import { enableTotp } from '@/lib/auth/security/service'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/security/totp/enable', securityRoutes)

export const POST = api(async (request) => {
  const { session } = await securitySession(request)
  const { code, challengeId } = z
    .object({
      code: z.string().refine(isTotpCode),
      challengeId: z.string().min(20).max(100),
    })
    .parse(await securityBody(request))
  return enableTotp(session, code, challengeId)
})
