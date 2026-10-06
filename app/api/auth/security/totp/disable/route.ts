import { withAuditRoute } from '@/lib/audit'
import {
  proofSchema,
  securityBody,
  securityRoute,
  securitySession,
} from '@/lib/auth/security/http'
import { changeTotp } from '@/lib/auth/security/service'

async function handlePOST(req: Request) {
  return securityRoute(async () => {
    const { session } = await securitySession(req)
    return changeTotp(session, proofSchema.parse(await securityBody(req)), true)
  })
}

export async function POST(req: Request) {
  return withAuditRoute(async () => handlePOST(req), {
    route: '/api/auth/security/totp/disable',
  })(req)
}
