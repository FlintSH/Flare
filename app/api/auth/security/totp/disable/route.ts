import {
  SECURITY_BODY_LIMIT,
  proofSchema,
  securityRoutes,
  securitySession,
} from '@/lib/auth/security/http'
import { changeTotp } from '@/lib/auth/security/service'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/security/totp/disable', securityRoutes)

export const POST = api(async (request) => {
  const { session } = await securitySession(request)
  return changeTotp(
    session,
    proofSchema.parse(await readJson(request, { limit: SECURITY_BODY_LIMIT })),
    true
  )
})
