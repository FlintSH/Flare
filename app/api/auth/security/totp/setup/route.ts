import { withAuditRoute } from '@/lib/audit'
import {
  proofSchema,
  securityBody,
  securityRoute,
  securitySession,
} from '@/lib/auth/security/http'
import { setupTotp } from '@/lib/auth/security/service'

async function handlePOST(req: Request) {
  return securityRoute(async () => {
    const { session } = await securitySession(req)
    return setupTotp(session, proofSchema.parse(await securityBody(req)))
  })
}

export async function POST(req: Request) {
  return withAuditRoute(async () => handlePOST(req), {
    route: '/api/auth/security/totp/setup',
  })(req)
}
