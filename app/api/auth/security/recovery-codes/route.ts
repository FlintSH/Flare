import {
  proofSchema,
  securityBody,
  securityRoutes,
  securitySession,
} from '@/lib/auth/security/http'
import { changeTotp } from '@/lib/auth/security/service'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/security/recovery-codes', securityRoutes)

export const POST = api(async (request) => {
  const { session } = await securitySession(request)
  return changeTotp(
    session,
    proofSchema.parse(await securityBody(request)),
    false
  )
})
