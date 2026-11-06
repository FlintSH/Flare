import {
  proofSchema,
  securityBody,
  securityRoutes,
  securitySession,
} from '@/lib/auth/security/http'
import { setupTotp } from '@/lib/auth/security/service'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/security/totp/setup', securityRoutes)

export const POST = api(async (request) => {
  const { session } = await securitySession(request)
  return setupTotp(session, proofSchema.parse(await securityBody(request)))
})
