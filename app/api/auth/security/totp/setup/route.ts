import {
  proofSchema,
  securityBody,
  securityRoute,
  securitySession,
} from '@/lib/auth/security/http'
import { setupTotp } from '@/lib/auth/security/service'

export async function POST(req: Request) {
  return securityRoute(async () => {
    const { session } = await securitySession(req)
    return setupTotp(session, proofSchema.parse(await securityBody(req)))
  })
}
