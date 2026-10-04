import {
  passkeyName,
  proofSchema,
  securityBody,
  securityRoute,
  securitySession,
} from '@/lib/auth/security/http'
import { registrationOptions } from '@/lib/auth/security/passkeys'

export async function POST(req: Request) {
  return securityRoute(async () => {
    const { session } = await securitySession(req)
    const data = proofSchema
      .extend({ name: passkeyName })
      .parse(await securityBody(req))
    return registrationOptions(session, data, data.name)
  })
}
