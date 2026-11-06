import { z } from 'zod'

import {
  SECURITY_BODY_LIMIT,
  securityRoutes,
  securitySession,
} from '@/lib/auth/security/http'
import { isTotpCode } from '@/lib/auth/security/policy'
import { enableTotp } from '@/lib/auth/security/service'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/security/totp/enable', securityRoutes)

export const POST = api(async (request) => {
  const { session } = await securitySession(request)
  const { code, challengeId } = await readJson(
    request,
    z.object({
      code: z.string().refine(isTotpCode),
      challengeId: z.string().min(20).max(100),
    }),
    { limit: SECURITY_BODY_LIMIT }
  )
  return enableTotp(session, code, challengeId)
})
