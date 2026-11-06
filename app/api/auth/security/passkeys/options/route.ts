import {
  SECURITY_BODY_LIMIT,
  passkeyName,
  proofSchema,
  securityRoutes,
  securitySession,
} from '@/lib/auth/security/http'
import { registrationOptions } from '@/lib/auth/security/passkeys'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'

const api = routes('/api/auth/security/passkeys/options', securityRoutes)

export const POST = api(async (request) => {
  const { session } = await securitySession(request)
  const data = proofSchema
    .extend({ name: passkeyName })
    .parse(await readJson(request, { limit: SECURITY_BODY_LIMIT }))
  return registrationOptions(session, data, data.name)
})
